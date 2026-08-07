import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import { loadEnv } from '../config/env.js';

/**
 * Makes the media bucket exist and be readable, for a LOCAL object store.
 *
 * ## The failure this exists to prevent
 *
 * `StorageService.publicUrl` builds `${S3_PUBLIC_URL ?? endpoint/bucket}/${key}` and hands it to
 * the browser. Nothing in the application verifies that address is actually fetchable — it cannot,
 * because readability is a property of the BUCKET POLICY, which lives in the object store rather
 * than in this codebase.
 *
 * The consequence was found by the first browser test to look at a thumbnail: every image on the
 * platform uploaded successfully, stored successfully, and rendered as a broken image, because the
 * development bucket had never been made anonymously readable. The upload reports success — it did
 * succeed — and the 403 happens later, in somebody else's browser, on a request the API never
 * sees. There is no error anywhere in our logs.
 *
 * ## Why a script rather than a line in the README
 *
 * A README step is a step somebody skips, and the symptom — images that are there in the database
 * and blank on the page — reads as an application bug for as long as it takes to think of the
 * bucket. Making it runnable means the answer to "why are the photos blank" is a command.
 *
 * ## Development only
 *
 * Refuses to touch a bucket it did not create locally: a public-read policy applied to the wrong
 * bucket is a data leak, and this script exists to save two minutes of setup, which is nowhere
 * near enough value to justify pointing it at production. Deployments configure the bucket and its
 * CDN through infrastructure, and set `S3_PUBLIC_URL` to the public hostname.
 */

/** Anonymous READ of objects, and nothing else — no listing, no writing, no deleting. */
function readOnlyPolicy(bucket: string): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'PublicReadObjects',
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        /*
          `GetObject` only. `ListBucket` is deliberately absent: with it, anybody could enumerate
          every media key on the platform, and the keys are the only thing standing between a
          stranger and every identity document ever uploaded — those live in the same bucket under
          a different prefix and are served through signed URLs precisely because they are private.
        */
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/properties/*`],
      },
    ],
  });
}

async function main(): Promise<void> {
  const env = loadEnv();
  const endpoint = env.S3_ENDPOINT;
  const bucket = env.S3_BUCKET;

  if (!endpoint || !bucket) {
    throw new Error(
      'S3_ENDPOINT and S3_BUCKET must be set to bootstrap local media storage.',
    );
  }

  /*
    A hosted endpoint is refused rather than trusted. `localhost` and `127.0.0.1` are the only
    addresses where "make this readable by everybody" is a safe default; anywhere else it is a
    decision for whoever owns the account, taken with the rest of the infrastructure.
  */
  const host = new URL(endpoint).hostname;

  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error(
      `Refusing to apply a public-read policy to a non-local endpoint (${host}). ` +
        'Configure the bucket and its CDN through infrastructure instead.',
    );
  }

  const client = new S3Client({
    region: env.S3_REGION ?? 'auto',
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
    },
  });

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`Bucket ${bucket} already exists.`);
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`Created bucket ${bucket}.`);
  }

  await client.send(
    new PutBucketPolicyCommand({ Bucket: bucket, Policy: readOnlyPolicy(bucket) }),
  );

  console.log(
    `Anonymous read enabled for ${bucket}/properties/*. Identity documents stay private.`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

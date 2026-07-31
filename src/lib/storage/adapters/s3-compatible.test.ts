import { describe, expect, it, mock } from "bun:test";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import {
  createS3CompatibleStore,
  type S3CompatibleStoreOptions,
} from "@/lib/storage/adapters/s3-compatible";
import { StorageError } from "@/lib/storage/types";

/**
 * Build an S3Client whose `.send()` is a Bun mock. Each test asserts
 * on the command instance the adapter sent, then drives whatever
 * shape of response is appropriate.
 */
function buildMockedClient(
  responder: (command: unknown) => Promise<unknown> | unknown,
): { client: S3Client; send: ReturnType<typeof mock> } {
  const send = mock(async (command: unknown) => responder(command));
  const client = {
    send,
  } as unknown as S3Client;
  return { client, send };
}

const baseOpts: Omit<S3CompatibleStoreOptions, "client"> = {
  bucket: "murmur-test",
  region: "auto",
  endpoint: "https://account.r2.cloudflarestorage.com",
  accessKeyId: "AKIA-test",
  secretAccessKey: "secret-test",
  publicUrlBase: "https://cdn.murmur.app",
};

describe("createS3CompatibleStore", () => {
  it("issues PutObjectCommand with the expected fields and returns a public CDN URL", async () => {
    const { client, send } = buildMockedClient(() => ({}));
    const store = createS3CompatibleStore({ ...baseOpts, client });

    const body = new Uint8Array([0x4d, 0x55, 0x52]); // "MUR"
    const result = await store.put("songs/master/usr_a/sng_b/01.mp3", body, {
      contentType: "audio/mpeg",
      scope: "public",
      meta: { source: "smoke" },
      ttlSeconds: 60,
    });

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]?.[0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input.Bucket).toBe("murmur-test");
    expect(command.input.Key).toBe("songs/master/usr_a/sng_b/01.mp3");
    expect(command.input.ContentType).toBe("audio/mpeg");
    expect(command.input.CacheControl).toBeUndefined();
    expect(command.input.Metadata).toEqual({ source: "smoke" });

    expect(result.scope).toBe("public");
    expect(result.size).toBe(3);
    expect(result.url).toBe(
      "https://cdn.murmur.app/songs/master/usr_a/sng_b/01.mp3",
    );
  });

  it("defaults scope to private and returns a canonical endpoint URL", async () => {
    const { client } = buildMockedClient(() => ({}));
    const store = createS3CompatibleStore({ ...baseOpts, client });

    const result = await store.put("tmp/_shared/_/x.bin", new Uint8Array([1]), {
      contentType: "application/octet-stream",
    });

    expect(result.scope).toBe("private");
    expect(result.url).toBe(
      "https://account.r2.cloudflarestorage.com/murmur-test/tmp/_shared/_/x.bin",
    );
  });

  it("get round-trips the body, content-type, and metadata", async () => {
    const responseBody = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const { client, send } = buildMockedClient((command) => {
      expect(command).toBeInstanceOf(GetObjectCommand);
      return {
        Body: responseBody,
        ContentType: "application/octet-stream",
        ContentLength: responseBody.byteLength,
        LastModified: new Date("2026-06-01T00:00:00Z"),
        Metadata: { source: "smoke" },
      };
    });
    const store = createS3CompatibleStore({ ...baseOpts, client });

    const got = await store.get("tmp/_shared/_/x.bin");
    expect(send).toHaveBeenCalledTimes(1);
    expect(got).not.toBeNull();
    expect(Array.from(got!.body)).toEqual(Array.from(responseBody));
    expect(got!.contentType).toBe("application/octet-stream");
    expect(got!.size).toBe(4);
    expect(got!.meta).toEqual({ source: "smoke" });
    expect(got!.storedAt.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("get drains an async-iterable Node stream into a Uint8Array", async () => {
    async function* asyncBody() {
      yield new Uint8Array([1, 2]);
      yield new Uint8Array([3, 4, 5]);
    }
    const { client } = buildMockedClient(() => ({
      Body: asyncBody(),
      ContentType: "audio/mpeg",
      ContentLength: 5,
    }));
    const store = createS3CompatibleStore({ ...baseOpts, client });

    const got = await store.get("songs/master/usr_a/sng_b/01.mp3");
    expect(Array.from(got!.body)).toEqual([1, 2, 3, 4, 5]);
  });

  it("get returns null when the underlying error is a NoSuchKey", async () => {
    const { client } = buildMockedClient(() => {
      const err = new Error("not found") as Error & { name: string };
      err.name = "NoSuchKey";
      throw err;
    });
    const store = createS3CompatibleStore({ ...baseOpts, client });

    const got = await store.get("tmp/_shared/_/missing.bin");
    expect(got).toBeNull();
  });

  it("get returns null when the SDK reports an HTTP 404", async () => {
    const { client } = buildMockedClient(() => {
      throw { $metadata: { httpStatusCode: 404 } };
    });
    const store = createS3CompatibleStore({ ...baseOpts, client });

    expect(await store.get("tmp/_shared/_/missing.bin")).toBeNull();
  });

  it("delete swallows NoSuchKey and bubbles other errors", async () => {
    const { client: missingClient } = buildMockedClient(() => {
      throw { $metadata: { httpStatusCode: 404 } };
    });
    await expect(
      createS3CompatibleStore({ ...baseOpts, client: missingClient }).delete(
        "tmp/_shared/_/missing.bin",
      ),
    ).resolves.toBeUndefined();

    const { client: brokenClient } = buildMockedClient(() => {
      throw new Error("ECONNRESET");
    });
    await expect(
      createS3CompatibleStore({ ...baseOpts, client: brokenClient }).delete(
        "tmp/_shared/_/x.bin",
      ),
    ).rejects.toBeInstanceOf(StorageError);
  });

  it("delete issues DeleteObjectCommand with the expected key", async () => {
    const { client, send } = buildMockedClient(() => ({}));
    const store = createS3CompatibleStore({ ...baseOpts, client });
    await store.delete("tmp/_shared/_/x.bin");

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]?.[0] as DeleteObjectCommand;
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input.Bucket).toBe("murmur-test");
    expect(command.input.Key).toBe("tmp/_shared/_/x.bin");
  });

  it("url('public') without publicUrlBase fails loudly", () => {
    const { client } = buildMockedClient(() => ({}));
    const store = createS3CompatibleStore({
      ...baseOpts,
      publicUrlBase: undefined,
      client,
    });
    expect(() => store.url("tmp/_shared/_/x.bin", "public")).toThrow(StorageError);
  });

  it("url('private') returns the canonical endpoint URL by default", () => {
    const { client } = buildMockedClient(() => ({}));
    const store = createS3CompatibleStore({ ...baseOpts, client });
    expect(store.url("tmp/_shared/_/x.bin", "private")).toBe(
      "https://account.r2.cloudflarestorage.com/murmur-test/tmp/_shared/_/x.bin",
    );
  });

  it("rejects unsafe keys before issuing any S3 call", async () => {
    const { client, send } = buildMockedClient(() => ({}));
    const store = createS3CompatibleStore({ ...baseOpts, client });
    await expect(
      store.put("../escape.bin", new Uint8Array([0]), {
        contentType: "application/octet-stream",
      }),
    ).rejects.toBeInstanceOf(StorageError);
    expect(send).toHaveBeenCalledTimes(0);
  });

  it("constructor refuses to build when required options are missing", () => {
    expect(() =>
      createS3CompatibleStore({
        ...baseOpts,
        bucket: "",
      }),
    ).toThrow(StorageError);
  });
});

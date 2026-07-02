import crypto from "crypto";

export function verifyLinearSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.LINEAR_WEBHOOK_SECRET!;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

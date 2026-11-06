import { PNG_1X1 } from "@/providers/fake";

export const PNG_BYTES = PNG_1X1;
// Cabeçalhos mínimos: o serviço só confere a assinatura (magic bytes).
export const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
export const WEBP_BYTES = Buffer.concat([
  Buffer.from("RIFF"), Buffer.from([0x1a, 0, 0, 0]), Buffer.from("WEBPVP8 "),
]);

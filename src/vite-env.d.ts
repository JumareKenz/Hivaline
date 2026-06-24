/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Dev-only override for the trusted Ed25519 .hiv signing public key (base64). */
  readonly VITE_HIVA_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

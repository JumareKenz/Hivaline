declare module '@noble/curves/ed25519.js' {
  export const ed25519: {
    verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean;
    sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array;
    getPublicKey(privateKey: Uint8Array): Uint8Array;
  };
}

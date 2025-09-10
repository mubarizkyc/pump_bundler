import {
    Connection,
    Keypair,
    PublicKey,
} from "@solana/web3.js";
import bs58 from "bs58";
// PRIV KEY OF FEEPAYER
export const payer = Keypair.fromSecretKey(Uint8Array.from([167, 189, 174, 216, 240, 134, 212, 18, 141, 38, 22, 140, 25, 128, 239, 91, 189, 8, 253, 143, 129, 160, 225, 102, 108, 134, 51, 223, 196, 254, 124, 68, 8, 169, 103, 65, 55, 16, 98, 58, 35, 158, 253, 25, 234, 192, 42, 8, 255, 231, 134, 27, 254, 111, 26, 90, 156, 120, 249, 32, 136, 26, 183, 88]));

// ENTER YOUR RPC
export const rpc = "https://api.devnet.solana.com ";


/* DONT TOUCH ANYTHING BELOW THIS */

export const connection = new Connection(rpc, "confirmed");

export const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");


export const global = new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");



export const eventAuthority = new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1");

export const feeRecipient = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");
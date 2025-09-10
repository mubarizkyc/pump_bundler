/**
 * bulk-pump-buy.js
 *
 * Node.js script that:
 *  - loads an array of wallet secret keys from wallets.json
 *  - builds a Pump.fun "buy" transaction for each wallet (you must implement buildBuyInstruction)
 *  - adds a tiny unique memo instruction per tx (prevents identical tx hashes)
 *  - uses the SAME recentBlockhash for all signed txs (max chance of same-slot inclusion)
 *  - signs and serializes txs and blasts them concurrently to multiple RPC endpoints
 *
 * Usage:
 *   - Fill RPC_ENDPOINTS array.
 *   - Provide wallets.json in same folder: ["<base58 secretKey array JSON>", ...] or arrays of numbers.
 *   - Implement buildBuyInstruction(...) to return an Instruction that executes the Pump.fun buy.
 *   - Run: node bulk-pump-buy.js
 *
 * NOTES:
 *  - This script uses @solana/web3.js and @solana/spl-memo.
 *  - Ensure each wallet is pre-funded and has required ATAs created for the buy.
 *  - This is NOT atomic. For guaranteed same-block atomicity use a bundle/block-builder (Jito).
 */

import fs from "fs";
import path from "path";
import { Keypair, Connection, Transaction, TransactionInstruction, sendAndConfirmRawTransaction, clusterApiUrl, PublicKey } from "@solana/web3.js";
import { MemoProgram } from "@solana/spl-memo";

// ---------- CONFIG ----------
const NUM_TXS_TO_SEND = 100; // number of buys to prepare (one per wallet)
const RPC_ENDPOINTS = [
    // Fill with multiple endpoints to flood (private RPCs + public nodes)
    "https://api.mainnet-beta.solana.com",
    "http://localhost:3000" // a proxy server
    // "https://your-private-rpc-1",
    // "https://your-private-rpc-2",
];

const WALLETS_JSON = path.join(process.cwd(), "wallets.json");
// Example wallets.json: an array of secretKey arrays (Uint8Array numbers) OR base58 strings.
// e.g. [ [1,2,3,...], [12,34, ...], ... ] OR ["3nT...base58", "4k..."]
// Make sure there are at least NUM_TXS_TO_SEND wallets in the file.

const FEE_PAYER_IS_BUYER = true; // typical: buyer pays its own fee. Change if you want a different fee payer.

// Pump.fun specifics - replace with real mint/account info:
const BUY_MINT = "REPLACE_WITH_TARGET_TOKEN_MINT_PUBKEY"; // string
const BUY_SOL_AMOUNT = 0.1; // SOL to spend (per buy) - replace as needed

// ---------- helpers ----------
function loadKeypairs(filename) {
    const raw = fs.readFileSync(filename, "utf8");
    const arr = JSON.parse(raw);
    const keypairs = arr.map((item, idx) => {
        if (Array.isArray(item)) {
            return Keypair.fromSecretKey(Uint8Array.from(item));
        } else if (typeof item === "string") {
            // assume base58 secret key; web3.js doesn't parse base58 secret by default: expect JSON array usually.
            // If user stores base58 private keys, they'd need to convert them into Uint8Array.
            // For security, prefer the numeric array format exported by Keypair.secretKey.
            throw new Error(`wallets.json contains string entries (base58). Use numeric secretKey arrays instead. index=${idx}`);
        } else {
            throw new Error("Unexpected wallet format in wallets.json");
        }
    });
    return keypairs;
}

// Convenience: converts sol to lamports
const LAMPORTS_PER_SOL = 1_000_000_000n;
function solToLamports(sol) {
    return BigInt(Math.floor(sol * 1e9));
}

// ---------- IMPORTANT: BUILD BUY INSTRUCTION (USER MUST MODIFY) ----------
/**
 * buildBuyInstruction
 *
 * Build the actual Pump.fun "buy" instruction for a single wallet.
 *
 * YOU MUST IMPLEMENT this using either:
 *  - your Pump.fun IDL + @coral-xyz/anchor and create the appropriate Instruction, OR
 *  - the Pump.fun SDK @pump-fun/pump-swap-sdk, or
 *  - manual instruction construction (PDA accounts, pool accounts, etc.)
 *
 * Signature:
 *  - buyer: PublicKey (the wallet that will sign and be feePayer)
 *  - uniqueByte: number (0..255) - a tiny uniqueness tweak you can optionally use inside your buy instruction (not required)
 *
 * Must return: TransactionInstruction
 *
 * EXAMPLE (PSEUDO):
 *  // const ix = pumpSdk.prepareBuyInstruction({ buyer: buyerPubkey, mint: BUY_MINT, solAmount: ... });
 *  // return ix;
 */
function buildBuyInstruction(buyer, uniqueByte) {
    // === IMPORTANT ===
    // Replace the code below with your own Pump.fun buy instruction builder.
    // This placeholder creates a NO-OP instruction (will fail) to show where to hook your buy.
    //
    // Example with Memo (NOT a buy): return MemoProgram.memo({ publicKey: buyer, memo: `demo-${uniqueByte}` });
    //
    throw new Error(
        "buildBuyInstruction() is a placeholder. Replace it with code that returns the actual Pump.fun buy TransactionInstruction."
    );
}

// ---------- Main flow ----------
async function main() {
    if (!fs.existsSync(WALLETS_JSON)) {
        console.error("wallets.json not found. Create it and re-run.");
        process.exit(1);
    }

    const keypairs = loadKeypairs(WALLETS_JSON);
    if (keypairs.length < NUM_TXS_TO_SEND) {
        console.error(`Not enough wallets in wallets.json. Need ${NUM_TXS_TO_SEND}, got ${keypairs.length}`);
        process.exit(1);
    }

    // Create connections for each RPC so we can send to many endpoints
    const connections = RPC_ENDPOINTS.map((url) => new Connection(url, "recent"));

    // Use the first connection to fetch a fresh blockhash (we'll reuse it for all txs in this batch)
    const primaryConnection = connections[0];
    console.log("Fetching recent blockhash from primary RPC...");
    const { blockhash, lastValidBlockHeight } = await primaryConnection.getLatestBlockhash("finalized");
    console.log("Got blockhash:", blockhash, "lastValidBlockHeight:", lastValidBlockHeight);

    // Prepare transactions
    const txs = []; // { signedRaw, signatureHint, ownerPubkey, endpointResults: [] }
    for (let i = 0; i < NUM_TXS_TO_SEND; i++) {
        const kp = keypairs[i];
        const buyerPubkey = kp.publicKey;

        // Build buy instruction - user must implement
        let buyIx;
        try {
            buyIx = buildBuyInstruction(buyerPubkey, i % 256);
        } catch (err) {
            console.error("buildBuyInstruction not implemented. Aborting. See the script comments to implement it.");
            throw err;
        }

        // Create transaction and add a tiny unique memo instruction to ensure txhash uniqueness
        const tx = new Transaction();
        // Add the actual buy instruction
        tx.add(buyIx);
        // Add memo with a one-byte unique id (encoded as decimal) - keeps txs different even with the same blockhash
        const memoText = `uid:${i % 256}`; // tiny uniqueness
        tx.add(MemoProgram.memo({ memo: memoText }));

        // Set fee payer
        tx.feePayer = FEE_PAYER_IS_BUYER ? buyerPubkey : keypairs[0].publicKey;

        // Set same recent blockhash for all transactions to maximize chance of same-slot inclusion
        tx.recentBlockhash = blockhash;

        // Sign with the buyer's keypair only (assuming buyer is fee payer and signer)
        tx.sign(kp);

        // Serialize
        const signedRaw = tx.serialize();

        txs.push({
            signedRaw,
            ownerPubkey: buyerPubkey.toBase58(),
            walletIndex: i,
            memo: memoText,
        });
    }

    console.log(`Prepared ${txs.length} signed transactions (all using same blockhash).`);

    // Blast them concurrently to all RPC endpoints.
    // Strategy: for each tx, send it to all RPC endpoints in parallel (so multiple validators may see it).
    // We'll collect results per tx per endpoint.
    const results = [];

    console.log("Sending transactions to RPC endpoints in parallel...");
    const sendPromises = [];

    for (const t of txs) {
        // For each tx we attempt to send to every endpoint concurrently.
        for (const conn of connections) {
            const p = (async () => {
                try {
                    // sendRawTransaction allows raw signed tx
                    // Set skipPreflight true for speed (risky); adjust as you prefer.
                    const sig = await conn.sendRawTransaction(t.signedRaw, { skipPreflight: true });
                    return { walletIndex: t.walletIndex, owner: t.ownerPubkey, endpoint: conn.rpcEndpoint, success: true, signature: sig };
                } catch (err) {
                    return { walletIndex: t.walletIndex, owner: t.ownerPubkey, endpoint: conn.rpcEndpoint, success: false, error: String(err) };
                }
            })();
            sendPromises.push(p);
        }
    }

    // limit concurrency? For simplicity we fire all and await. You can use p-limit if you need rate-limit.
    const settled = await Promise.allSettled(sendPromises);

    // normalize results
    const summary = {};
    for (const s of settled) {
        if (s.status === "fulfilled") {
            const r = s.value;
            const key = `${r.walletIndex}:${r.endpoint}`;
            summary[key] = r;
        } else {
            // shouldn't happen because inside we catch errors, but just in case:
            console.error("Unexpected rejected promise:", s.reason);
        }
    }

    // Print a simple report: per wallet, which endpoints returned a signature
    const perWallet = {};
    for (const k of Object.keys(summary)) {
        const rec = summary[k];
        const w = rec.walletIndex;
        perWallet[w] = perWallet[w] || { successes: [], failures: [] };
        if (rec.success) perWallet[w].successes.push({ endpoint: rec.endpoint, signature: rec.signature });
        else perWallet[w].failures.push({ endpoint: rec.endpoint, error: rec.error });
    }

    console.log("=== Send Summary ===");
    for (let i = 0; i < NUM_TXS_TO_SEND; i++) {
        const r = perWallet[i] || { successes: [], failures: [] };
        console.log(`Wallet #${i} (${txs[i].owner}) -> successes: ${r.successes.length}, failures: ${r.failures.length}`);
        if (r.successes.length) {
            console.log("  example signature:", r.successes[0].signature, "from", r.successes[0].endpoint);
        }
    }

    // Optionally: wait a bit and fetch blocks / confirmations to see which ones landed in same slot.
    console.log("Done sending. Inspect signatures above and use getConfirmedBlock / getBlock to check slot inclusion per signature.");
}

main()
    .then(() => {
        console.log("finished");
        process.exit(0);
    })
    .catch((err) => {
        console.error("Fatal error:", err);
        process.exit(1);
    });
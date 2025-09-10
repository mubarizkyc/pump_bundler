import { payer, connection, PUMP_PROGRAM, eventAuthority, rpc } from "./config";
import {
    PublicKey,
    VersionedTransaction,
    TransactionInstruction,
    SYSVAR_RENT_PUBKEY,
    TransactionMessage,
    SystemProgram,
    Keypair,
    LAMPORTS_PER_SOL,
    Transaction
} from "@solana/web3.js";
import {
    createInitializeMintInstruction,
    MINT_SIZE,
    getMinimumBalanceForRentExemptMint,
    TOKEN_2022_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccountInstruction,
    ASSOCIATED_TOKEN_PROGRAM_ID

} from "@solana/spl-token";

import { loadKeypairs, createKeypairs } from "./keys_manager";
import * as spl from "@solana/spl-token";
import fs from "fs";
import BN from "bn.js";
import { PumpSdk, getBuyTokenAmountFromSolAmount } from "@pump-fun/pump-sdk";
import { TOKEN_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";
import { ComputeBudgetProgram } from "@solana/web3.js";
import { generateKey } from "crypto";
const keyInfoPath = "./keyInfo.json";
const TOKEN_PROGRAM = TOKEN_PROGRAM_ID;
const sdk = new PumpSdk(connection);
const wsol_mint = new PublicKey("So11111111111111111111111111111111111111112");
/*
Flow 
User Creates 100 wallets they stay there
then he creates ata for all othem which is a necessity
*/

export async function create_atas(mint: PublicKey) {
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
        units: 360_000,
    });

    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 1,
    });

    const keypairs: Keypair[] = loadKeypairs();
    const txs: VersionedTransaction[] = [];

    let batch: TransactionInstruction[] = [modifyComputeUnits, addPriorityFee];
    let ataCount = 0;
    for (const kp of keypairs) {
        const ata = getAssociatedTokenAddressSync(
            mint,
            kp.publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const ix = spl.createAssociatedTokenAccountIdempotentInstruction(
            payer.publicKey,   // payer funds the rent
            ata,
            kp.publicKey,       // ATA owner
            mint
        );

        batch.push(ix);
        ataCount++;

        if (ataCount === 10) {
            const blockhash = await connection.getLatestBlockhash();
            const msg = new TransactionMessage({
                payerKey: payer.publicKey,
                recentBlockhash: blockhash.blockhash,
                instructions: batch,
            }).compileToV0Message();

            const tx = new VersionedTransaction(msg);
            tx.sign([payer]);
            txs.push(tx);

            // reset
            batch = [modifyComputeUnits, addPriorityFee];
            ataCount = 0;
        }
    }

    // flush leftovers
    if (ataCount > 0) {
        const blockhash = await connection.getLatestBlockhash();
        const msg = new TransactionMessage({
            payerKey: payer.publicKey,
            recentBlockhash: blockhash.blockhash,
            instructions: batch,
        }).compileToV0Message();

        const tx = new VersionedTransaction(msg);
        tx.sign([payer]);
        txs.push(tx);
    }

    // send & confirm
    for (const tx of txs) {
        const sig = await connection.sendTransaction(tx, { skipPreflight: true });
        console.log("Sent:", sig);

        const latestBlockhash = await connection.getLatestBlockhash();
        const resp = await connection.confirmTransaction(
            {
                signature: sig,
                blockhash: latestBlockhash.blockhash,
                lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
            },
            "confirmed"
        );
        console.log("Resp ", resp);
    }
}

export async function fundWithWsol(amount: number) {
    const keypairs: Keypair[] = loadKeypairs();

    const blockhash = await connection.getLatestBlockhash();
    const txs: VersionedTransaction[] = [];
    let batch: TransactionInstruction[] = [];
    const payerAta = await spl.getAssociatedTokenAddress(wsol_mint, payer.publicKey);
    for (const kp of keypairs) {
        const ix = spl.createTransferCheckedInstruction(
            payerAta,
            wsol_mint,
            getAssociatedTokenAddressSync(wsol_mint, kp.publicKey),
            payer.publicKey,
            amount,
            9,
            [],
            TOKEN_PROGRAM_ID
        );

        batch.push(ix);

        // pack up to 10 transfers per tx (safe size)
        if (batch.length === 10) {
            const msg = new TransactionMessage({
                payerKey: payer.publicKey,
                recentBlockhash: blockhash.blockhash,
                instructions: batch,
            }).compileToV0Message();

            const tx = new VersionedTransaction(msg);
            tx.sign([payer]);
            txs.push(tx);
            batch = [];
        }
    }

    // handle leftover transfers
    if (batch.length > 0) {
        const msg = new TransactionMessage({
            payerKey: payer.publicKey,
            recentBlockhash: blockhash.blockhash,
            instructions: batch,
        }).compileToV0Message();

        const tx = new VersionedTransaction(msg);
        tx.sign([payer]);
        txs.push(tx);
    }

    console.log(`Prepared ${txs.length} funding transactions`);

    // fire them all at once
    const sigs = await Promise.all(
        txs.map(tx => connection.sendTransaction(tx, { skipPreflight: true }))
    );

    sigs.forEach(sig => console.log(`Funded wallets with wsol tx: ${sig}`));

    return sigs;
}
export async function fundWallets(lamports: number, bufferPct: number = 0) {
    const keypairs: Keypair[] = loadKeypairs();

    const blockhash = await connection.getLatestBlockhash();
    const adjustedLamports = Math.floor(lamports * (1 + bufferPct));
    const txs: VersionedTransaction[] = [];
    let batch: TransactionInstruction[] = [];

    for (const kp of keypairs) {
        const ix = SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: kp.publicKey,
            lamports,
        });
        batch.push(ix);

        // pack up to 10 transfers per tx (safe size)
        if (batch.length === 10) {
            const msg = new TransactionMessage({
                payerKey: payer.publicKey,
                recentBlockhash: blockhash.blockhash,
                instructions: batch,
            }).compileToV0Message();

            const tx = new VersionedTransaction(msg);
            tx.sign([payer]);
            txs.push(tx);
            batch = [];
        }
    }

    // handle leftover transfers
    if (batch.length > 0) {
        const msg = new TransactionMessage({
            payerKey: payer.publicKey,
            recentBlockhash: blockhash.blockhash,
            instructions: batch,
        }).compileToV0Message();

        const tx = new VersionedTransaction(msg);
        tx.sign([payer]);
        txs.push(tx);
    }

    console.log(`Prepared ${txs.length} funding transactions`);

    // fire them all at once
    const sigs = await Promise.all(
        txs.map(tx => connection.sendTransaction(tx, { skipPreflight: true }))
    );

    sigs.forEach(sig => console.log(`Funded wallets tx: ${sig}`));

    return sigs;
}
//for testing purposes
export async function createPumpToken(): Promise<PublicKey> {
    const mintKp = Keypair.generate(); // new mint account
    const blockhash = await connection.getLatestBlockhash();

    // Build the instruction (assuming SDK handles initialization)
    const ix = await sdk.createInstruction({
        mint: mintKp.publicKey,
        name: "name",
        symbol: "symbol",
        uri: "uri",
        creator: payer.publicKey,
        user: payer.publicKey,
    });

    const msg = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: blockhash.blockhash,
        instructions: [ix],
    }).compileToV0Message();

    const tx = new VersionedTransaction(msg);
    tx.sign([payer, mintKp]); // ✅ both payer + mint authority

    const sig = await connection.sendTransaction(tx, { skipPreflight: true });
    console.log("Created token tx:", sig);

    return mintKp.publicKey;
}

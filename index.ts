import { payer, connection, PUMP_PROGRAM, eventAuthority, rpc } from "./config";
import { create_atas, fundWallets, fundWithWsol, createPumpToken } from "./utils"
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


export async function buyToken(mint: PublicKey, wsol_amount: number) {
    // Load keypairs
    const keypairs: Keypair[] = loadKeypairs();

    // Load JSON key info
    let keyInfo: { [key: string]: { solAmount: number; tokenAmount: string } } = {};
    if (fs.existsSync(keyInfoPath)) {
        keyInfo = JSON.parse(fs.readFileSync(keyInfoPath, "utf-8"));
    }
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
        units: 1_400_000,
    });

    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 1,
    });

    // Reuse single blockhash for all txns
    const blockhash = await connection.getLatestBlockhash();
    const global = await sdk.fetchGlobal();

    const txs: VersionedTransaction[] = [];
    let batch: TransactionInstruction[] = [];
    let signers: Keypair[] = [];
    // push compute budget ixs at start
    batch.push(modifyComputeUnits);
    batch.push(addPriorityFee);

    for (const kp of keypairs) {
        /*
        const info = keyInfo[kp.publicKey.toBase58()];
        
        if (!info) {
            console.log(`No info for ${kp.publicKey.toBase58()}, skipping`);
            continue;
        }
*/
        //  const solAmount = new BN(info.solAmount * LAMPORTS_PER_SOL);
        const solAmount = new BN(wsol_amount);
        const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } =
            await sdk.fetchBuyState(mint, kp.publicKey);

        // Compute how many tokens this sol buys
        const amount = getBuyTokenAmountFromSolAmount({
            global,
            feeConfig: null,
            mintSupply: null,
            bondingCurve,
            amount: solAmount,
        });

        const buyIx = await sdk.buyInstructions({
            global,
            bondingCurveAccountInfo,
            bondingCurve,
            associatedUserAccountInfo,
            mint,
            user: kp.publicKey,
            solAmount,
            amount,
            slippage: 1,
        });

        batch.push(...buyIx);
        signers.push(kp);

        // If batch reaches 4 buys, seal the transaction
        if (signers.length === 4) {
            const msg = new TransactionMessage({
                payerKey: payer.publicKey,  // global payer
                recentBlockhash: blockhash.blockhash,
                instructions: batch,
            }).compileToV0Message();

            const tx = new VersionedTransaction(msg);
            tx.sign([payer, ...signers]);
            txs.push(tx);

            // reset
            batch = [];
            signers = [];
            batch.push(modifyComputeUnits);
            batch.push(addPriorityFee);
        }
    }

    // Handle leftover buys (<4)
    if (signers.length > 0) {
        const msg = new TransactionMessage({
            payerKey: payer.publicKey,
            recentBlockhash: blockhash.blockhash,
            instructions: batch,
        }).compileToV0Message();

        const tx = new VersionedTransaction(msg);
        tx.sign([payer, ...signers]);
        txs.push(tx);
    }

    console.log(`Prepared ${txs.length} transactions`);

    // Fire all at once (no confirmation wait)
    const sigs = await Promise.all(
        txs.map(tx => connection.sendTransaction(tx, { skipPreflight: true }))
    );

    sigs.forEach(sig => console.log(`Sent tx: ${sig}`));
}

async function main() {
    //create keypairs
    await createKeypairs();

    //create atas;
    const token_mint = await createPumpToken();
    await create_atas(token_mint);
    console.log("Created x token accounts for all wallets");

    await create_atas(wsol_mint);
    console.log("Created wsol token accounts for all wallets");
    //fund wallets with sol
    await fundWallets(10000000); //transfer 0.01 sol
    console.log("wallets funded wiht sol");
    await fundWithWsol(10000); //transfer 0.00001 wsol
    console.log("wallets funded with wsol");
    await buyToken(token_mint, 10000);
    console.log("tokens bought");

}
main();
import { payer, connection, PUMP_PROGRAM, eventAuthority, rpc } from "./config";
import { create_atas, fundWallets, fundWithWsol, createPumpToken, altCreator } from "./utils"
import {
    PublicKey,
    VersionedTransaction,
    TransactionInstruction,
    SYSVAR_RENT_PUBKEY,
    TransactionMessage,
    SystemProgram,
    Keypair,
    LAMPORTS_PER_SOL,
    Transaction,
    AccountMeta
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
    const keypairs: Keypair[] = loadKeypairs();

    // compute once
    const global = await sdk.fetchGlobal();
    const solAmount = new BN(wsol_amount);

    console.log("Fetching buy state once...");
    const { bondingCurveAccountInfo, bondingCurve } =
        await sdk.fetchBuyState(mint, payer.publicKey); // use payer just to get curve
    console.log("Got bonding curve info");

    console.log("Computing token amount once...");
    const amount = getBuyTokenAmountFromSolAmount({
        global,
        feeConfig: null,
        mintSupply: null,
        bondingCurve,
        amount: solAmount,
    });
    console.log(`One buy = ${amount.toString()} tokens for ${wsol_amount} lamports`);

    // budget ixs
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
        units: 1_400_000,
    });
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 0,
    });


    const txs: VersionedTransaction[] = [];
    let batch: TransactionInstruction[] = [];
    let signers: Keypair[] = [];


    const ata_addresses = keypairs.map(kp => getAssociatedTokenAddressSync(mint, kp.publicKey));

    const ata_infos = await connection.getMultipleAccountsInfo(ata_addresses);
    const sample_buy_Ix = await sdk.buyInstructions({
        global,
        bondingCurveAccountInfo,
        bondingCurve,
        associatedUserAccountInfo: ata_infos[0],
        mint,
        user: payer.publicKey,
        solAmount,
        amount,
        slippage: 1,
    });
    /*
    const uniquePubkeys: PublicKey[] = [
        ...new Set(sample_buy_Ix.flatMap(ix => ix.keys.map(k => k.pubkey.toBase58())))
    ].map(str => new PublicKey(str));

    const lookupTableAddress = await altCreator(uniquePubkeys);
    //const lookupTableAddress = new PublicKey("Dm1ztsirv4FKuH52ZNVZTh1bkzymUXWijNupKVgLcgz3");
    const lookupTableAccount = (
        await connection.getAddressLookupTable(lookupTableAddress)
    ).value;
    if (!lookupTableAccount) {
        console.log("Failed to create alt");
        return null;
    }
    */
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    for (const [i, kp] of keypairs.entries()) {
        //console.log(`\n=== Processing wallet ${i + 1}/${keypairs.length}: ${kp.publicKey.toBase58()} ===`);



        //        console.log("Building buy instructions...");

        const buyIx = await sdk.buyInstructions({
            global,
            bondingCurveAccountInfo,
            bondingCurve,
            associatedUserAccountInfo: ata_infos[i],
            mint,
            user: kp.publicKey,
            solAmount,
            amount,
            slippage: 2,
        });

        //  console.log("Built buy instructions");

        batch.push(...buyIx);
        signers.push(kp);

        // If batch reaches 2 buys, seal the transaction
        if (signers.length === 2) {
            console.log(`Sealing transaction with ${signers.length} signers...`);

            const msg = new TransactionMessage({
                payerKey: payer.publicKey,
                recentBlockhash: blockhash,
                instructions: batch,
            }).compileToV0Message();

            const tx = new VersionedTransaction(msg);
            tx.sign([payer, ...signers]);
            txs.push(tx);

            // reset for next batch
            batch = [];
            signers = [];

            // refresh blockhash for next tx round
            // ({ blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash());
            //    console.log(`Refreshed blockhash: ${blockhash}`);
        }
    }

    if (signers.length > 0) {
        console.log(`Final leftover batch with ${signers.length} signers...`);

        const msg = new TransactionMessage({
            payerKey: payer.publicKey,
            recentBlockhash: blockhash,
            instructions: batch,
        }).compileToV0Message(); // ✅ use lookup table

        const tx = new VersionedTransaction(msg);
        tx.sign([payer, ...signers]);
        txs.push(tx);
    }

    console.log(`\nPrepared ${txs.length} transactions`);

    console.log("Sending transactions...");
    const sigs = await Promise.all(
        txs.map(async (tx, i) => {
            console.log(`Sending tx ${i + 1}/${txs.length}...`);
            return await connection.sendTransaction(tx, {
                skipPreflight: true,
                maxRetries: 0,
            });
        })
    );

    console.log("All transactions sent:");
    sigs.forEach(sig => console.log(` - ${sig}`));

    return sigs;
}

async function main() {
    //create keypairs
    await createKeypairs();

    //create atas;
    // const token_mint = await createPumpToken();
    const token_mint = new PublicKey("97aWsdR3FoCtgNKZLjCjU9zbybQjtjVxtFkbY48ceLBJ");

    await create_atas(token_mint);
    console.log("Created x token accounts for all wallets");

    await create_atas(wsol_mint);
    console.log("Created wsol token accounts for all wallets");
    //fund wallets with sol
    await fundWallets(10000000);
    console.log("wallets funded wiht sol");
    await fundWithWsol(100);
    console.log("wallets funded with wsol");

    await buyToken(token_mint, 100);

    console.log("tokens bought");

}
main();
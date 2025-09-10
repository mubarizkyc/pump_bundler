import { Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import inquirer from 'inquirer';
import path from 'path';
import bs58 from 'bs58';

const keypairsDir = path.join(__dirname, 'keypairs');
const keyInfoPath = path.join(__dirname, 'keyInfo.json');

interface IPoolInfo {
    [key: string]: any;
    numOfWallets?: number;
}

if (!fs.existsSync(keypairsDir)) {
    fs.mkdirSync(keypairsDir, { recursive: true });
}

function generateWallets(numOfWallets: number): Keypair[] {
    let wallets: Keypair[] = [];
    for (let i = 0; i < numOfWallets; i++) {
        wallets.push(Keypair.generate());
    }
    return wallets;
}

function saveKeypairToFile(keypair: Keypair, index: number) {
    const keypairPath = path.join(keypairsDir, `keypair${index + 1}.json`);
    fs.writeFileSync(keypairPath, JSON.stringify(Array.from(keypair.secretKey)));
}

function readKeypairs(): Keypair[] {
    const files = fs.readdirSync(keypairsDir);
    return files.map(file => {
        const filePath = path.join(keypairsDir, file);
        const secretKey = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return Keypair.fromSecretKey(new Uint8Array(secretKey));
    });
}

function updatePoolInfo(wallets: Keypair[]) {
    let poolInfo: IPoolInfo = {};

    if (fs.existsSync(keyInfoPath)) {
        const data = fs.readFileSync(keyInfoPath, 'utf8');
        poolInfo = JSON.parse(data);
    }

    poolInfo.numOfWallets = wallets.length;
    wallets.forEach((wallet, index) => {
        poolInfo[`pubkey${index + 1}`] = wallet.publicKey.toString();
    });

    fs.writeFileSync(keyInfoPath, JSON.stringify(poolInfo, null, 2));
}

export async function createKeypairs() {
    console.log('⚠️ WARNING: If you create new wallets, ensure you don\'t have SOL in them, OR ELSE IT WILL BE GONE.');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Do you want to create new wallets or use existing ones?',
            choices: [
                { name: 'Create new wallets', value: 'c' },
                { name: 'Use existing wallets', value: 'u' }
            ]
        }
    ]);

    let wallets: Keypair[] = [];

    if (action === 'c') {
        const numOfWallets = 2; // hardcoded
        wallets = generateWallets(numOfWallets);
        wallets.forEach((wallet, index) => {
            saveKeypairToFile(wallet, index);
            console.log(`Wallet ${index + 1} Public Key: ${wallet.publicKey.toString()}`);
        });
    } else {
        wallets = readKeypairs();
        wallets.forEach((wallet, index) => {
            console.log(`Read Wallet ${index + 1} Public Key: ${wallet.publicKey.toString()}`);
            console.log(`Read Wallet ${index + 1} Private Key: ${bs58.encode(wallet.secretKey)}\n`);
        });
    }

    updatePoolInfo(wallets);
    console.log(`${wallets.length} wallets have been processed.`);
}

export function loadKeypairs(): Keypair[] {
    const keypairRegex = /^keypair\d+\.json$/;

    return fs.readdirSync(keypairsDir)
        .filter(file => keypairRegex.test(file))
        .map(file => {
            const filePath = path.join(keypairsDir, file);
            const secretKeyString = fs.readFileSync(filePath, 'utf8');
            const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
            return Keypair.fromSecretKey(secretKey);
        });
}

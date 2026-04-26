import {
  hexStringToBase64,
  ParaWeb,
  SuccessfulSignatureRes,
  Wallet,
} from '@getpara/web-sdk';
import { keccak_256 as keccak256 } from '@noble/hashes/sha3.js';
import {
  accountSeedFromStr,
  evmPkToCommitment,
  fromHexSig,
  getUncompressedPublicKeyFromWallet,
  txSummaryToJosn,
} from './utils.js';
import type { MidenAccountOpts, Opts, TxSummaryJson } from './types.js';
import type { MidenClient } from '@miden-sdk/miden-sdk/lazy';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { accountSelectionModal, signingModal } from './modalClient.js';

export type CustomSignConfirmStep = (
  txSummaryJson: TxSummaryJson
) => Promise<unknown>;

/**
 * Creates a signing callback that routes Miden signing requests through Para.
 * Prompts the user with a modal before delegating the keccak-hashed message to Para's signer,
 * and optionally runs a custom confirmation step in between.
 */
export const signCb = (
  para: ParaWeb,
  wallet: Wallet,
  showSigningModal: boolean,
  customSignConfirmStep?: CustomSignConfirmStep
) => {
  return async (_: Uint8Array, signingInputs: Uint8Array) => {
    const { SigningInputs } = await import('@miden-sdk/miden-sdk/lazy');
    const inputs = SigningInputs.deserialize(signingInputs);
    let commitment = inputs.toCommitment().toHex().slice(2);
    const hashed = bytesToHex(keccak256(hexToBytes(commitment)));
    const txSummaryJson = txSummaryToJosn(inputs.transactionSummaryPayload());
    if (showSigningModal) {
      const confirmed = await signingModal(txSummaryJson);
      if (!confirmed) {
        throw new Error('User cancelled signing');
      }
    }
    if (customSignConfirmStep) {
      await customSignConfirmStep(txSummaryJson);
    }
    console.time('Para Signing Time');
    const res = await para.signMessage({
      walletId: wallet.id,
      messageBase64: hexStringToBase64(hashed),
    });
    console.timeEnd('Para Signing Time');
    const signature = (res as SuccessfulSignatureRes).signature;
    const sig = fromHexSig(signature);
    return sig;
  };
};

/**
 * Pattern B: arbitrary-byte signing for `useSignBytes`.
 *
 * Generalizes the existing `signCb` flow to handle both `kind` values:
 *   - 'word'         → bytes ARE a serialized 32-byte Miden Word.
 *   - 'signingInputs' → extract the commitment Word via `inputs.toCommitment()`.
 * In both cases the underlying primitive is `ECDSA-sign(keccak256(word_bytes))`,
 * matching the wallet's `Vault.signData` semantics. Verified against
 * `~/miden/miden-wallet/src/lib/miden/back/vault.ts:476-500`.
 *
 * Unlike `signCb`, this path does NOT prompt — `useSignBytes` is a developer-
 * facing primitive. If your dApp needs UX confirmation, build it on top.
 */
export const signBytes = (para: ParaWeb, wallet: Wallet) => {
  return async (
    data: Uint8Array,
    kind: 'word' | 'signingInputs'
  ): Promise<Uint8Array> => {
    const { SigningInputs, Word } = await import('@miden-sdk/miden-sdk/lazy');
    const word =
      kind === 'word'
        ? Word.deserialize(data)
        : SigningInputs.deserialize(data).toCommitment();
    // keccak256 the Word's bytes — matches WASM secretKey.sign(word) internally.
    // Word.toHex() always returns "0x..." per the @miden-sdk contract (same
    // shape the existing signCb above relies on with .slice(2)).
    const wordHex = word.toHex().slice(2);
    const hashed = bytesToHex(keccak256(hexToBytes(wordHex)));
    const res = await para.signMessage({
      walletId: wallet.id,
      messageBase64: hexStringToBase64(hashed),
    });
    return fromHexSig((res as SuccessfulSignatureRes).signature);
  };
};

/**
 * Ensures a Miden account exists for the given Para wallet public key.
 * Attempts to import an existing account for public/network modes before creating a new one.
 */
async function createAccount(
  client: MidenClient,
  publicKey: string,
  opts: MidenAccountOpts
) {
  const { AccountBuilder, AccountComponent, AccountStorageMode } =
    await import('@miden-sdk/miden-sdk/lazy');

  await client.sync();
  let pkc = await evmPkToCommitment(publicKey);
  // create a new account
  const accountBuilder = new AccountBuilder(
    accountSeedFromStr(opts.accountSeed) ?? new Uint8Array(32).fill(0)
  );

  let accountStorageMode;

  if (opts.storageMode === 'public') {
    accountStorageMode = AccountStorageMode.public();
  } else if (opts.storageMode === 'private') {
    accountStorageMode = AccountStorageMode.private();
  } else {
    accountStorageMode = AccountStorageMode.network();
  }

  const account = accountBuilder
    .withAuthComponent(
      AccountComponent.createAuthComponentFromCommitment(pkc, 1)
    )
    .accountType(opts.type)
    .storageMode(accountStorageMode)
    .withBasicWalletComponent()
    .build().account;

  // If the account already exists on-chain (e.g. public/network), hydrate it instead of
  // recreating a “new” account with zero commitment, which causes submission to fail.
  if (opts.storageMode !== 'private') {
    try {
      await client.accounts.import(account);
    } catch {
      // Import will fail for non-existent accounts; fall through to creation path.
    }
  }

  // check if account exists locally after the import attempt
  const existing = await client.accounts.get(account.id());
  if (!existing) {
    await client.accounts.insert({ account });
  }
  await client.sync();
  return account.id().toString();
}

/**
 * Builds a MidenClient wired to Para wallets and ensures an account exists for the user.
 * Filters to EVM wallets, prompts for selection, creates the client, and
 * hydrates or creates the corresponding Miden account before returning the client + account id.
 */
export async function createParaMidenClient(
  para: ParaWeb,
  wallets: Wallet[],
  opts: Opts,
  showSigningModal: boolean = true,
  customSignConfirmStep?: CustomSignConfirmStep
) {
  const evmWallets = wallets.filter((wallet) => wallet.type === 'EVM');

  if (!evmWallets?.length) {
    throw new Error('No EVM wallets provided');
  }

  const accountKeys = await Promise.all(
    evmWallets.map((w) => getUncompressedPublicKeyFromWallet(para, w))
  );
  const selectedIndex = await accountSelectionModal(accountKeys);
  const wallet = evmWallets[selectedIndex] ?? evmWallets[0];
  const publicKey = accountKeys[selectedIndex] ?? accountKeys[0];

  const { MidenClient } = await import('@miden-sdk/miden-sdk/lazy');
  if (opts.storageMode === 'private' && !opts.accountSeed) {
    throw new Error('accountSeed is required when using private storage mode');
  }
  const signCallback = signCb(para, wallet, showSigningModal, customSignConfirmStep);
  const noteTransportUrl =
    opts.noteTransportUrl ||
    opts.nodeTransportUrl ||
    'https://transport.miden.io';

  const client = await MidenClient.create({
    rpcUrl: opts.endpoint,
    noteTransportUrl,
    seed: accountSeedFromStr(opts.seed),
    keystore: {
      getKey: async () => undefined,
      insertKey: async () => {},
      sign: signCallback,
    },
    autoSync: true,
  });

  const accountId = await createAccount(
    client,
    publicKey,
    opts as MidenAccountOpts
  );

  return { client, accountId };
}

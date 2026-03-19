import type React from 'react';
import type { MidenClient } from '@miden-sdk/miden-sdk';
import { type MintAndConsumeProgress, MintAndConsumeStage } from './types';

export async function createFaucetMintAndConsume(
  client: MidenClient,
  accountId: string,
  setProgress: React.Dispatch<
    React.SetStateAction<MintAndConsumeProgress | null>
  >
) {
  const { MidenClient } = await import('@miden-sdk/miden-sdk');
  setProgress({ stage: MintAndConsumeStage.CreatingFaucet });
  const faucetClient = await MidenClient.create({ autoSync: true });
  const faucet = await faucetClient.accounts.create({
    type: 'FungibleFaucet',
    symbol: 'MID',
    decimals: 8,
    maxSupply: 1_000_000_0000_00n,
  });
  setProgress((state) => ({
    ...state,
    stage: MintAndConsumeStage.CreatedFaucet,
    faucetId: faucet.id().toString(),
  }));
  setProgress((state) => ({
    ...state,
    stage: MintAndConsumeStage.MintingTokens,
  }));
  const mintResult = await faucetClient.transactions.mint({
    account: faucet,
    to: accountId,
    amount: 1000n * BigInt(1e8),
    type: 'public',
  });
  console.log('Mint Tx Hash:', mintResult.txId.toHex());
  setProgress((state) => ({
    ...state,
    stage: MintAndConsumeStage.MintedTokens,
    mintTxHash: mintResult.txId.toHex(),
  }));
  await new Promise((resolve) => setTimeout(resolve, 10000));
  console.log('Proceeding to consume tokens...');
  setProgress((state) => ({
    ...state,
    stage: MintAndConsumeStage.ConsumingTokens,
  }));
  await client.sync();
  const consumeResult = await client.transactions.consumeAll({
    account: accountId,
  });
  await client.sync();
  setProgress((state) => ({
    ...state,
    stage: MintAndConsumeStage.ConsumedTokens,
    consumeTxHash: consumeResult.txId.toHex(),
  }));
}

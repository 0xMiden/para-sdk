import type { MidenClient } from '@miden-sdk/miden-sdk';

export async function send(
  client: MidenClient,
  fromAccountId: string,
  toAddress: string,
  faucetId: string,
  amount: bigint
) {
  await client.sync();
  const result = await client.transactions.send({
    account: fromAccountId,
    to: toAddress,
    token: faucetId,
    amount: amount * BigInt(1e8),
    type: 'private',
    returnNote: true,
  });
  await client.notes.sendPrivate({ note: result.note, to: toAddress });
  return {
    txHash: result.txId.toHex(),
  };
}

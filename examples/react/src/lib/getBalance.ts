export async function getBalance(accountId: string) {
  const { MidenClient } = await import('@miden-sdk/miden-sdk');

  const client = await MidenClient.create({ autoSync: true });
  const account = await client.accounts.get(accountId);
  if (!account) {
    throw new Error('Account not found');
  }
  client.terminate();
  return account
    .vault()
    .fungibleAssets()
    .map((asset) => ({
      assetId: asset.faucetId().toString(),
      balance: (Number(asset.amount()) / 1e8).toString(),
    }));
}

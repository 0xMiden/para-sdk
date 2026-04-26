'use client';

import { useClient, useAccount, type Wallet } from '@getpara/react-sdk-lite';
import type { MidenClient } from '@miden-sdk/miden-sdk/lazy';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createParaMidenClient,
  type Opts,
  type MidenAccountStorageMode,
  type CustomSignConfirmStep,
} from '@miden-sdk/miden-para/lazy';

/**
 * React hook that converts Para React SDK context into a ready-to-use MidenClient.
 * Spawns the client once a Para session with at least one EVM wallet is active.
 *
 * Returns:
 * - client: MidenClient instance backed by the active Para session (or null while loading)
 * - accountId: Miden account id derived for the selected EVM wallet
 * - para: Para client instance from context
 * - evmWallets: filtered list of Para wallets with type === 'EVM'
 * - nodeUrl: Miden node endpoint used for the client
 * - opts: forwarded options used when creating the client
 * - showSigningModal: toggles the built-in signing modal
 * - customSignConfirmStep: optional callback for custom transaction confirmation flows
 */
export function useParaMiden(
  nodeUrl: string,
  storageMode: MidenAccountStorageMode = 'public',
  opts: Omit<Opts, 'endpoint' | 'type' | 'storageMode'> = {},
  showSigningModal: boolean = true,
  customSignConfirmStep?: CustomSignConfirmStep
) {
  const para = useClient();
  const { isConnected, embedded } = useAccount();
  const clientRef = useRef<MidenClient | null>(null);
  const [accountId, setAccountId] = useState<string>('');

  const evmWallets = useMemo(
    () => embedded.wallets?.filter((wallet) => wallet.type === 'EVM'),
    [embedded.wallets]
  );

  useEffect(() => {
    let cancelled = false;

    async function setupClient() {
      if (
        !isConnected ||
        !para ||
        !embedded.wallets?.length ||
        clientRef.current
      ) {
        return;
      }

      const { AccountType } = await import('@miden-sdk/miden-sdk/lazy');

      const { client: midenParaClient, accountId: aId } =
        await createParaMidenClient(
          para,
          evmWallets as Wallet[],
          {
            ...opts,
            endpoint: nodeUrl,
            type: AccountType.RegularAccountImmutableCode,
            storageMode,
          },
          showSigningModal,
          customSignConfirmStep
        );

      if (cancelled) {
        return;
      }

      clientRef.current = midenParaClient;
      setAccountId(aId);
    }

    setupClient();

    return () => {
      cancelled = true;
    };
  }, [
    isConnected,
    evmWallets,
    para,
    nodeUrl,
    showSigningModal,
    customSignConfirmStep,
  ]);

  return {
    client: clientRef.current,
    accountId,
    para,
    evmWallets,
    nodeUrl,
    opts,
  };
}

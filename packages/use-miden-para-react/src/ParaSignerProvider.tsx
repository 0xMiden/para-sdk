import {
  useState,
  useEffect,
  useCallback,
  useRef,
  createContext,
  useContext,
  type ReactNode,
} from 'react';
import { ParaWeb, Environment, type Wallet } from '@getpara/web-sdk';
import {
  ParaProvider,
  useClient,
  useModal,
  useLogout,
  type ParaProviderProps,
} from '@getpara/react-sdk-lite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  SignerContext,
  type SignerContextValue,
  type SignerAccountConfig,
} from '@miden-sdk/react';
import {
  signCb as createSignCb,
  type CustomSignConfirmStep,
} from '@miden-sdk/miden-para';
import {
  evmPkToCommitment,
  getUncompressedPublicKeyFromWallet,
} from '@miden-sdk/miden-para';

// Re-export Para hooks for convenience
export { useModal, useLogout } from '@getpara/react-sdk-lite';

const defaultQueryClient = new QueryClient();

// PARA SIGNER PROVIDER
// ================================================================================================

/** Environment string values accepted by ParaSignerProvider */
export type ParaEnvironment =
  | 'BETA'
  | 'PROD'
  | 'SANDBOX'
  | 'DEV'
  | 'DEVELOPMENT'
  | 'PRODUCTION';

/**
 * Convert environment string to Environment enum value.
 * Handles the mapping safely for both ESM and CJS environments.
 */
function getEnvironmentValue(env: ParaEnvironment): Environment {
  // Handle aliases
  const normalizedEnv =
    env === 'DEVELOPMENT' ? 'BETA' : env === 'PRODUCTION' ? 'PROD' : env;

  // Try accessing the enum - Environment may be undefined in some test environments
  if (Environment && typeof Environment === 'object') {
    const value = Environment[normalizedEnv as keyof typeof Environment];
    if (value !== undefined) return value;
  }

  // Fallback: return the string directly (Para SDK may accept string values)
  return normalizedEnv as unknown as Environment;
}

export interface ParaSignerProviderProps {
  children: ReactNode;
  /** Para API key */
  apiKey: string;
  /** Para environment (BETA, PROD, SANDBOX, DEV, DEVELOPMENT, PRODUCTION) */
  environment: ParaEnvironment;
  /** App name displayed in Para modal */
  appName?: string;
  /** Whether to show the signing modal for transaction confirmation */
  showSigningModal?: boolean;
  /** Custom sign confirmation step callback */
  customSignConfirmStep?: CustomSignConfirmStep;
  /**
   * Optional custom QueryClient instance for React Query.
   * If not provided, a default instance is used internally.
   */
  queryClient?: QueryClient;
  /**
   * Advanced: Additional config to pass to ParaProvider.
   * Use this for customizing OAuth methods, external wallets, etc.
   */
  paraProviderConfig?: Partial<
    Omit<ParaProviderProps<any, any>, 'children' | 'paraClientConfig'>
  >;
  /** Optional custom account components to include in the account (e.g. from a compiled .masp package) */
  customComponents?: SignerAccountConfig['customComponents'];
}

/**
 * Para-specific extras exposed via useParaSigner hook.
 */
export interface ParaSignerExtras {
  /** Para client instance */
  para: ParaWeb;
  /** Connected wallet (null if not connected) */
  wallet: Wallet | null;
}

const ParaSignerExtrasContext = createContext<ParaSignerExtras | null>(null);

/**
 * ParaSignerProvider wraps MidenProvider to enable Para wallet signing.
 * Includes ParaProvider internally, so you don't need to wrap with it separately.
 *
 * @example
 * ```tsx
 * <ParaSignerProvider apiKey="your-api-key" environment="BETA" appName="My App">
 *   <MidenProvider config={{ rpcUrl: "testnet" }}>
 *     <App />
 *   </MidenProvider>
 * </ParaSignerProvider>
 * ```
 */
export function ParaSignerProvider({
  children,
  apiKey,
  environment,
  appName = 'Miden App',
  showSigningModal = true,
  customSignConfirmStep,
  queryClient,
  paraProviderConfig,
  customComponents,
}: ParaSignerProviderProps) {
  return (
    <QueryClientProvider client={queryClient ?? defaultQueryClient}>
      <ParaProvider
        paraClientConfig={{
          env: getEnvironmentValue(environment),
          apiKey,
        }}
        config={{ appName }}
        {...paraProviderConfig}
      >
        <ParaSignerProviderInner
          showSigningModal={showSigningModal}
          customSignConfirmStep={customSignConfirmStep}
          customComponents={customComponents}
        >
          {children}
        </ParaSignerProviderInner>
      </ParaProvider>
    </QueryClientProvider>
  );
}

/**
 * Inner component that has access to ParaProvider context (useModal, etc.)
 */
function ParaSignerProviderInner({
  children,
  showSigningModal = true,
  customSignConfirmStep,
  customComponents,
}: Pick<
  ParaSignerProviderProps,
  'children' | 'showSigningModal' | 'customSignConfirmStep' | 'customComponents'
>) {
  // Access Para modal from ParaProvider.
  // Store in refs to avoid re-render loops (these hooks return new objects each render).
  const { openModal } = useModal();
  const { logoutAsync } = useLogout();
  const openModalRef = useRef(openModal);
  const logoutAsyncRef = useRef(logoutAsync);
  useEffect(() => {
    openModalRef.current = openModal;
  }, [openModal]);
  useEffect(() => {
    logoutAsyncRef.current = logoutAsync;
  }, [logoutAsync]);

  // Get the Para client from ParaProvider context (avoids creating a duplicate instance).
  // Store in a ref so downstream effects don't re-fire when the hook returns a new wrapper.
  const para = useClient()!;
  const paraRef = useRef(para);
  useEffect(() => {
    paraRef.current = para;
  }, [para]);

  // Keep props in refs so buildContext doesn't re-run when parent re-renders with new closures.
  const showSigningModalRef = useRef(showSigningModal);
  const customSignConfirmStepRef = useRef(customSignConfirmStep);
  useEffect(() => {
    showSigningModalRef.current = showSigningModal;
  }, [showSigningModal]);
  useEffect(() => {
    customSignConfirmStepRef.current = customSignConfirmStep;
  }, [customSignConfirmStep]);

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Check connection status on mount and periodically
  useEffect(() => {
    let cancelled = false;

    async function checkConnection() {
      try {
        const isLoggedIn = await paraRef.current.isFullyLoggedIn();
        if (!isLoggedIn || cancelled) {
          setIsConnected(false);
          setWallet(null);
          return;
        }

        const wallets = Object.values(await paraRef.current.getWallets());
        const evmWallets = wallets.filter((w) => w.type === 'EVM');

        if (evmWallets.length > 0 && !cancelled) {
          setWallet((prev) =>
            prev?.id === evmWallets[0].id ? prev : evmWallets[0]
          );
          setIsConnected(true);
        } else if (!cancelled) {
          setIsConnected(false);
          setWallet(null);
        }
      } catch {
        if (!cancelled) {
          setIsConnected(false);
          setWallet(null);
        }
      }
    }

    checkConnection();
    const interval = setInterval(checkConnection, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Connect opens the Para modal
  const connect = useCallback(async () => {
    openModalRef.current();
  }, []);

  // Disconnect logs out from Para
  const disconnect = useCallback(async () => {
    await logoutAsyncRef.current();
    await paraRef.current.logout();
    setIsConnected(false);
    setWallet(null);
  }, []);

  // Build signer context (includes connect/disconnect for unified useSigner hook).
  // Only depends on isConnected and wallet — everything else is accessed via refs
  // so that MidenProvider doesn't see a new context object on every poll cycle.
  //
  // IMPORTANT: initialise with a disconnected placeholder (isConnected:false) rather
  // than null.  When signerContext is null MidenProvider creates a local-keystore
  // client whose auto-sync accesses the WASM module; our buildContext also touches
  // WASM (evmPkToCommitment / AccountStorageMode) → concurrent WASM access → crash.
  // A {isConnected:false} context makes MidenProvider's init effect return early
  // without creating any client, keeping the WASM module free for buildContext.
  const disconnectedCtx = useRef<SignerContextValue>({
    signCb: async () => {
      throw new Error('Para wallet not connected');
    },
    accountConfig: null as any,
    storeName: '',
    name: 'Para',
    isConnected: false,
    connect,
    disconnect,
  });
  const [signerContext, setSignerContext] = useState<SignerContextValue>(
    disconnectedCtx.current
  );

  useEffect(() => {
    let cancelled = false;

    async function buildContext() {
      if (!isConnected || !wallet) {
        setSignerContext(disconnectedCtx.current);
        return;
      }

      try {
        // Connected - build full context with signing capability
        const p = paraRef.current;
        const publicKey = await getUncompressedPublicKeyFromWallet(p, wallet);
        if (!publicKey) throw new Error('Failed to get public key from wallet');
        const commitment = await evmPkToCommitment(publicKey);

        // Serialize the commitment Word to Uint8Array for SignerAccountConfig
        const commitmentBytes = commitment.serialize();

        const signCallback = createSignCb(
          p,
          wallet,
          showSigningModalRef.current,
          customSignConfirmStepRef.current
        );

        if (!cancelled) {
          const { AccountStorageMode } = await import('@miden-sdk/miden-sdk');

          setSignerContext({
            signCb: signCallback,
            accountConfig: {
              publicKeyCommitment: commitmentBytes,
              accountType: 'RegularAccountImmutableCode',
              storageMode: AccountStorageMode.public(),
              ...(customComponents?.length ? { customComponents } : {}),
            },
            storeName: `para_${wallet.id}`,
            name: 'Para',
            isConnected: true,
            connect,
            disconnect,
          });
        }
      } catch (error) {
        console.error('Failed to build Para signer context:', error);
        if (!cancelled) {
          setSignerContext(disconnectedCtx.current);
        }
      }
    }

    buildContext();
    return () => {
      cancelled = true;
    };
  }, [isConnected, wallet, connect, disconnect]);

  return (
    <ParaSignerExtrasContext.Provider value={{ para, wallet }}>
      <SignerContext.Provider value={signerContext}>
        {children}
      </SignerContext.Provider>
    </ParaSignerExtrasContext.Provider>
  );
}

/**
 * Hook for Para-specific extras beyond the unified useSigner interface.
 * Use this to access the Para client or wallet details directly.
 *
 * @example
 * ```tsx
 * const { para, wallet, isConnected } = useParaSigner();
 * ```
 */
export function useParaSigner(): ParaSignerExtras & { isConnected: boolean } {
  const extras = useContext(ParaSignerExtrasContext);
  const signer = useContext(SignerContext);
  if (!extras) {
    throw new Error('useParaSigner must be used within ParaSignerProvider');
  }
  return { ...extras, isConnected: signer?.isConnected ?? false };
}

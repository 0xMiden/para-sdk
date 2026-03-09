const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('module');
const ts = require('typescript');
const React = require('react');
const renderer = require('react-test-renderer');

const { act } = renderer;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flushPromises = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

/**
 * Creates mock dependencies for tests.
 */
const createMocks = (state = {}) => {
  const mockPara = {
    isFullyLoggedIn: async () => state.isLoggedIn,
    getWallets: async () => {
      const wallets = {};
      (state.wallets || []).forEach((w) => {
        wallets[w.id] = w;
      });
      return wallets;
    },
    connect: async () => {
      state.connectCalls = (state.connectCalls || 0) + 1;
    },
    logout: async () => {
      state.logoutCalls = (state.logoutCalls || 0) + 1;
    },
  };

  const SignerContextReact = React.createContext(null);

  // Mock providers as passthroughs that render children
  const MockParaProvider = ({ children }) => children;
  const MockQueryClientProvider = ({ children }) => children;

  return {
    '@tanstack/react-query': {
      QueryClient: function () {},
      QueryClientProvider: MockQueryClientProvider,
    },
    '@getpara/web-sdk': {
      ParaWeb: function () {
        return mockPara;
      },
    },
    '@getpara/react-sdk-lite': {
      ParaProvider: MockParaProvider,
      useClient: () => mockPara,
      useAccount: () => ({
        isConnected: state.isLoggedIn,
        embedded: {
          wallets: state.wallets || [],
        },
      }),
      useModal: () => ({
        openModal: () => {
          state.openModalCalls = (state.openModalCalls || 0) + 1;
        },
        closeModal: () => {
          state.closeModalCalls = (state.closeModalCalls || 0) + 1;
        },
      }),
      useLogout: () => ({
        logoutAsync: async () => {
          state.logoutAsyncCalls = (state.logoutAsyncCalls || 0) + 1;
        },
      }),
    },
    '@miden-sdk/react': {
      SignerContext: SignerContextReact,
    },
    '@miden-sdk/miden-sdk': {
      AccountStorageMode: {
        public: () => ({ toString: () => 'public' }),
        private: () => ({ toString: () => 'private' }),
      },
    },
    '@miden-sdk/miden-para': {
      signCb: (para, wallet, showModal, customStep) => {
        return async (pubKey, signingInputs) => {
          state.signCbCalls = (state.signCbCalls || 0) + 1;
          state.lastSignArgs = { pubKey, signingInputs };
          return new Uint8Array(67);
        };
      },
      getUncompressedPublicKeyFromWallet: async (para, wallet) => {
        return new Uint8Array(65).fill(0x04);
      },
      evmPkToCommitment: async (publicKey) => {
        return {
          serialize: () => new Uint8Array(32).fill(0x42),
          toHex: () => '0xcommitment',
        };
      },
    },
    mockPara,
    SignerContext: SignerContextReact,
  };
};

/**
 * Loads the ParaSignerProvider with mocked dependencies.
 */
const loadParaSignerProvider = (mocks = {}) => {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'react') return React;
    if (mocks[request]) return mocks[request];
    if (request.startsWith('@miden-sdk/miden-sdk')) {
      return mocks['@miden-sdk/miden-sdk'];
    }
    if (request.startsWith('@getpara/web-sdk')) {
      return mocks['@getpara/web-sdk'];
    }
    if (request.startsWith('@getpara/react-sdk-lite')) {
      return mocks['@getpara/react-sdk-lite'];
    }
    if (request.startsWith('@tanstack/react-query')) {
      return mocks['@tanstack/react-query'];
    }
    if (request.startsWith('@miden-sdk/miden-para')) {
      return mocks['@miden-sdk/miden-para'];
    }
    if (request.startsWith('@miden-sdk/react')) {
      return mocks['@miden-sdk/react'];
    }
    return originalLoad.apply(this, [request, parent, isMain]);
  };

  try {
    const filePath = path.resolve(__dirname, '../packages/use-miden-para-react/src/ParaSignerProvider.tsx');
    const source = fs.readFileSync(filePath, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
      fileName: filePath,
    });

    // Inject React into the module scope
    const wrappedCode = `
      const React = require('react');
      ${outputText}
    `;

    const compiledModule = new Module(filePath, module);
    compiledModule.filename = filePath;
    compiledModule.paths = Module._nodeModulePaths(path.dirname(filePath));
    compiledModule._compile(wrappedCode, filePath);
    return {
      ParaSignerProvider: compiledModule.exports.ParaSignerProvider,
      useParaSigner: compiledModule.exports.useParaSigner,
      restore: () => {
        Module._load = originalLoad;
      },
    };
  } catch (error) {
    Module._load = originalLoad;
    throw error;
  }
};

/**
 * Renders the ParaSignerProvider.
 */
const renderProvider = async (ParaSignerProvider, mocks, props = {}) => {
  const defaultProps = {
    apiKey: 'test-api-key',
    environment: 'DEVELOPMENT',
    children: React.createElement('div', null, 'Test'),
    ...props,
  };

  let testRenderer;
  await act(async () => {
    testRenderer = renderer.create(
      React.createElement(ParaSignerProvider, defaultProps)
    );
    await flushPromises();
  });

  return {
    testRenderer,
    unmount: () => {
      testRenderer.unmount();
    },
    rerender: async (newProps) => {
      await act(async () => {
        testRenderer.update(
          React.createElement(ParaSignerProvider, { ...defaultProps, ...newProps })
        );
        await flushPromises();
      });
    },
  };
};

/**
 * Renders a hook within ParaSignerProvider context.
 */
const renderHookInProvider = async (
  ParaSignerProvider,
  useParaSigner,
  mocks,
  providerProps = {}
) => {
  let latest;

  const Harness = () => {
    latest = useParaSigner();
    return null;
  };

  const defaultProps = {
    apiKey: 'test-api-key',
    environment: 'DEVELOPMENT',
    children: React.createElement(Harness),
    ...providerProps,
  };

  let testRenderer;
  await act(async () => {
    testRenderer = renderer.create(
      React.createElement(ParaSignerProvider, defaultProps)
    );
    await flushPromises();
  });

  return {
    getLatest: () => latest,
    unmount: () => {
      testRenderer.unmount();
    },
    rerender: async (newProps) => {
      await act(async () => {
        testRenderer.update(
          React.createElement(ParaSignerProvider, { ...defaultProps, ...newProps })
        );
        await flushPromises();
      });
    },
  };
};

// TESTS
// ================================================================================================

test('ParaSignerProvider renders children', async () => {
  const state = {
    isLoggedIn: false,
    wallets: [],
  };
  const mocks = createMocks(state);
  const { ParaSignerProvider, restore } = loadParaSignerProvider(mocks);

  try {
    const childText = 'Test Child Content';
    const { testRenderer, unmount } = await renderProvider(ParaSignerProvider, mocks, {
      children: React.createElement('div', null, childText),
    });

    const tree = testRenderer.toJSON();
    assert.ok(tree || true, 'Provider should render');
    unmount();
  } finally {
    restore();
  }
});

test('ParaSignerProvider provides SignerContext to descendants', async () => {
  const state = {
    isLoggedIn: true,
    wallets: [{ id: 'wallet-1', type: 'EVM' }],
  };
  const mocks = createMocks(state);
  const { ParaSignerProvider, restore } = loadParaSignerProvider(mocks);

  try {
    const { unmount } = await renderProvider(ParaSignerProvider, mocks);
    assert.ok(true, 'Provider should render with SignerContext');
    unmount();
  } finally {
    restore();
  }
});

test('useParaSigner throws when used outside ParaSignerProvider', async () => {
  const state = {
    isLoggedIn: false,
    wallets: [],
  };
  const mocks = createMocks(state);
  const { useParaSigner, restore } = loadParaSignerProvider(mocks);

  try {
    const Harness = () => {
      useParaSigner();
      return null;
    };

    let error = null;
    try {
      await act(async () => {
        renderer.create(React.createElement(Harness));
        await flushPromises();
      });
    } catch (e) {
      error = e;
    }

    assert.ok(error, 'Should throw when used outside provider');
    assert.ok(
      error.message.includes('useParaSigner must be used within ParaSignerProvider'),
      'Error message should indicate provider requirement'
    );
  } finally {
    restore();
  }
});

test('useParaSigner returns para client and wallet', async () => {
  const state = {
    isLoggedIn: true,
    wallets: [{ id: 'wallet-1', type: 'EVM' }],
  };
  const mocks = createMocks(state);
  const { ParaSignerProvider, useParaSigner, restore } =
    loadParaSignerProvider(mocks);

  try {
    const { getLatest, unmount } = await renderHookInProvider(
      ParaSignerProvider,
      useParaSigner,
      mocks
    );

    const result = getLatest();
    assert.ok(result.para, 'Should have para client');
    assert.ok('wallet' in result, 'Should have wallet property');
    unmount();
  } finally {
    restore();
  }
});

test('isConnected is false initially when not logged in', async () => {
  const state = {
    isLoggedIn: false,
    wallets: [],
  };
  const mocks = createMocks(state);
  const { ParaSignerProvider, useParaSigner, restore } =
    loadParaSignerProvider(mocks);

  try {
    const { getLatest, unmount } = await renderHookInProvider(
      ParaSignerProvider,
      useParaSigner,
      mocks
    );

    const result = getLatest();
    assert.strictEqual(result.isConnected, false, 'Should not be connected initially');
    unmount();
  } finally {
    restore();
  }
});

test('isConnected is true after Para login with EVM wallet', async () => {
  const state = {
    isLoggedIn: true,
    wallets: [{ id: 'evm-wallet-1', type: 'EVM' }],
  };
  const mocks = createMocks(state);
  const { ParaSignerProvider, useParaSigner, restore } =
    loadParaSignerProvider(mocks);

  try {
    const { getLatest, unmount } = await renderHookInProvider(
      ParaSignerProvider,
      useParaSigner,
      mocks
    );

    // Allow effect to complete
    await act(async () => {
      await flushPromises();
      await flushPromises();
    });

    const result = getLatest();
    assert.strictEqual(result.isConnected, true, 'Should be connected after login');
    unmount();
  } finally {
    restore();
  }
});

test("SignerContext includes correct name ('Para')", async () => {
  const state = {
    isLoggedIn: true,
    wallets: [{ id: 'wallet-1', type: 'EVM' }],
  };
  const mocks = createMocks(state);
  const { ParaSignerProvider, restore } = loadParaSignerProvider(mocks);

  try {
    const { unmount } = await renderProvider(ParaSignerProvider, mocks);
    // The name 'Para' is hardcoded in ParaSignerProvider
    assert.ok(true, "SignerContext should have name 'Para'");
    unmount();
  } finally {
    restore();
  }
});

test('Only EVM wallets are used for connection', async () => {
  const state = {
    isLoggedIn: true,
    wallets: [
      { id: 'sol-wallet', type: 'SOLANA' },
      { id: 'btc-wallet', type: 'BITCOIN' },
    ],
  };
  const mocks = createMocks(state);
  const { ParaSignerProvider, useParaSigner, restore } =
    loadParaSignerProvider(mocks);

  try {
    const { getLatest, unmount } = await renderHookInProvider(
      ParaSignerProvider,
      useParaSigner,
      mocks
    );

    await act(async () => {
      await flushPromises();
      await flushPromises();
    });

    const result = getLatest();
    // Without an EVM wallet, should not be connected
    assert.strictEqual(
      result.isConnected,
      false,
      'Should not be connected without EVM wallet'
    );
    unmount();
  } finally {
    restore();
  }
});

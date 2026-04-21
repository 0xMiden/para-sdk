import "./style.css";
import { paraAccount } from "./lib/paraAccount";
import { paraAuth } from "./lib/paraAuth";
import { para } from "./lib/client";
import { createParaMidenClient } from "miden-para";

// Get DOM elements
const connectBtn = document.getElementById("connect-btn") as HTMLButtonElement;
const disconnectBtn = document.getElementById(
  "disconnect-btn"
) as HTMLButtonElement;

const statusConnected = document.getElementById(
  "status-connected"
) as HTMLSpanElement;
const statusAddress = document.getElementById(
  "status-address"
) as HTMLSpanElement;

// Modal elements
const authModal = document.getElementById("auth-modal") as HTMLDivElement;
const modalClose = document.getElementById("modal-close") as HTMLButtonElement;
const modalError = document.getElementById("modal-error") as HTMLDivElement;
const modalLoading = document.getElementById("modal-loading") as HTMLDivElement;

// OAuth elements
const oauthUrl = document.getElementById("oauth-url") as HTMLParagraphElement;

// Miden elements
const midenSection = document.getElementById("miden-section") as HTMLDivElement;
const midenAccountId = document.getElementById(
  "miden-account-id"
) as HTMLSpanElement;
const midenAddress = document.getElementById(
  "miden-address"
) as HTMLSpanElement;
const balancesList = document.getElementById("balances-list") as HTMLDivElement;
const refreshBalanceBtn = document.getElementById(
  "refresh-balance"
) as HTMLButtonElement;
const mintConsumeBtn = document.getElementById(
  "mint-consume-btn"
) as HTMLButtonElement;
const mintConsumeStatus = document.getElementById(
  "mint-consume-status"
) as HTMLDivElement;
const faucetId = document.getElementById("faucet-id") as HTMLSpanElement;
const mintTxHash = document.getElementById("mint-tx-hash") as HTMLSpanElement;
const consumeTxHash = document.getElementById(
  "consume-tx-hash"
) as HTMLSpanElement;
const mintConsumeStatusText = document.getElementById(
  "mint-consume-status-text"
) as HTMLSpanElement;

// Store Miden client data
let midenClientData: {
  client: any;
  accountId: string;
  address: string;
} | null = null;

// Subscribe to account state changes
paraAccount.subscribe(async (state) => {
  statusConnected.textContent = String(state.isConnected);
  statusAddress.textContent = state.address || "-";

  // Toggle buttons
  if (state.isConnected) {
    connectBtn.classList.add("hidden");
    disconnectBtn.classList.remove("hidden");

    // Initialize Miden client when connected
    if (!midenClientData) {
      await initializeMidenClient();
    }
  } else {
    connectBtn.classList.remove("hidden");
    disconnectBtn.classList.add("hidden");
    midenSection.classList.add("hidden");
    midenClientData = null;
  }
});

// Subscribe to auth state changes
paraAuth.subscribe((state) => {
  // Show/hide modal
  if (state.isOpen) {
    authModal.classList.remove("hidden");
  } else {
    authModal.classList.add("hidden");
  }

  // Show/hide loading overlay
  if (state.isLoading) {
    modalLoading.classList.remove("hidden");
  } else {
    modalLoading.classList.add("hidden");
  }

  // Show/hide error
  if (state.error) {
    modalError.textContent = state.error;
    modalError.classList.remove("hidden");
  } else {
    modalError.classList.add("hidden");
  }
});

// Connect button handler - directly start Google OAuth
connectBtn.addEventListener("click", async () => {
  paraAuth.openModal();

  let isCancelled = false;

  try {
    await paraAuth.verifyOAuth(
      "GOOGLE",
      (url) => {
        oauthUrl.textContent = url;
        window.open(url, "_blank");
      },
      () => isCancelled
    );

    await paraAuth.waitForLogin(() => isCancelled);
  } catch (error) {
    console.error("OAuth failed:", error);
  }
});

// Disconnect button handler
disconnectBtn.addEventListener("click", async () => {
  try {
    await paraAuth.logout();
  } catch (error) {
    console.error("Failed to logout:", error);
  }
});

// Modal close handlers
modalClose.addEventListener("click", () => {
  paraAuth.closeModal();
});

authModal.addEventListener("click", (e) => {
  if (e.target === authModal) {
    paraAuth.closeModal();
  }
});

// Check authentication on load
paraAccount.checkAuthentication();

async function initializeMidenClient() {
  try {
    midenSection.classList.remove("hidden");

    const data = await initClient();
    midenClientData = data;

    midenAccountId.textContent = data.accountId;
    midenAddress.textContent = data.address;

    // Load initial balances
    await refreshBalances();
  } catch (error) {
    console.error("Failed to initialize Miden client:", error);
  }
}

async function refreshBalances() {
  if (!midenClientData) return;

  try {
    balancesList.innerHTML = '<p class="text-gray-500">Loading balances...</p>';
    const balances = await getBalance(midenClientData.accountId);

    if (balances.length === 0) {
      balancesList.innerHTML = '<p class="text-gray-500">No assets found</p>';
    } else {
      balancesList.innerHTML = balances
        .map(
          (asset) => `
        <p><strong>Asset ${asset.assetId}:</strong> ${asset.balance}</p>
      `
        )
        .join("");
    }
  } catch (error) {
    console.error("Failed to load balances:", error);
    balancesList.innerHTML =
      '<p class="text-red-600">Error loading balances</p>';
  }
}

refreshBalanceBtn.addEventListener("click", refreshBalances);

mintConsumeBtn.addEventListener("click", async () => {
  if (!midenClientData) return;

  try {
    mintConsumeBtn.disabled = true;
    mintConsumeBtn.textContent = "Running...";
    mintConsumeStatus.classList.remove("hidden");
    mintConsumeStatusText.textContent = "Starting...";

    const result = await runMintAndConsume();

    faucetId.textContent = result.faucetId;
    mintTxHash.textContent = result.mintTxHash;
    consumeTxHash.textContent = result.consumeTxHash;
    mintConsumeStatusText.textContent = "Completed successfully!";

    // Refresh balances after completion
    await refreshBalances();
  } catch (error) {
    console.error("Mint & Consume failed:", error);
    mintConsumeStatusText.textContent =
      "Error: " + (error instanceof Error ? error.message : "Unknown error");
  } finally {
    mintConsumeBtn.disabled = false;
    mintConsumeBtn.textContent = "Run Mint & Consume Example";
  }
});

const initClient = async () => {
  const { AccountType, Address, AccountId, NetworkId } = await import(
    "@demox-labs/miden-sdk"
  );
  const wallets = await paraAccount.getWallets();
  const res = await createParaMidenClient(para, wallets, {
    type: AccountType.RegularAccountImmutableCode,
    storageMode: "public",
    accountSeed: "plain-example",
  });
  const address = Address.fromAccountId(
    AccountId.fromHex(res.accountId),
    "BasicWallet"
  ).toBech32(NetworkId.Testnet);
  return {
    client: res.client,
    accountId: res.accountId,
    address,
  };
};

async function runMintAndConsume() {
  if (!midenClientData) throw new Error("Miden client not initialized");

  const { client, accountId } = midenClientData;
  const { WebClient, AccountStorageMode, NoteType, AccountId } = await import(
    "@demox-labs/miden-sdk"
  );

  mintConsumeStatusText.textContent = "Creating faucet...";
  const newClient = await WebClient.createClient();
  await newClient.syncState();
  const faucet = await newClient.newFaucet(
    AccountStorageMode.public(),
    false,
    "MID",
    8,
    BigInt(1_000_000_0000_00),
    0
  );

  const faucetIdStr = faucet.id().toString();
  faucetId.textContent = faucetIdStr;

  mintConsumeStatusText.textContent = "Syncing state...";
  await client.syncState();
  const to = await client.getAccount(AccountId.fromHex(accountId));
  if (!to) {
    throw new Error("Account not found");
  }

  mintConsumeStatusText.textContent = "Minting tokens...";
  const mintTxRequest = newClient.newMintTransactionRequest(
    to.id(),
    faucet.id(),
    NoteType.Public,
    BigInt(1000) * BigInt(1e8)
  );
  const txHash = await newClient.submitNewTransaction(
    faucet.id(),
    mintTxRequest
  );
  mintTxHash.textContent = txHash.toHex();

  mintConsumeStatusText.textContent = "Waiting for transaction confirmation...";
  await new Promise((resolve) => setTimeout(resolve, 10000));

  mintConsumeStatusText.textContent = "Consuming notes...";
  await client.syncState();
  const mintedNotes = await client.getConsumableNotes(to.id());
  const mintedNoteIds = mintedNotes.map((n: any) =>
    n.inputNoteRecord().id().toString()
  );
  const consumeTxRequest = client.newConsumeTransactionRequest(mintedNoteIds);
  const consumeTxHashResult = await client.submitNewTransaction(
    to.id(),
    consumeTxRequest
  );
  consumeTxHash.textContent = consumeTxHashResult.toHex();

  await client.syncState();

  return {
    faucetId: faucetIdStr,
    mintTxHash: txHash.toHex(),
    consumeTxHash: consumeTxHashResult.toHex(),
  };
}

export async function getBalance(accountId: string) {
  const { WebClient, AccountId } = await import("@demox-labs/miden-sdk");

  const client = await WebClient.createClient(); // default endpoint is tesnet
  await client.syncState();

  const account = await client.getAccount(AccountId.fromHex(accountId));
  if (!account) {
    throw new Error("Account not found");
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

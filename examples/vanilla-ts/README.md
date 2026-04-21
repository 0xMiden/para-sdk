# Vanilla Miden x Para Integration

This example demostrates how to use the `miden-para` with vanilla js/ts

## How It Works

### 1. Authentication Flow

Users authenticate using Para's social login (Google OAuth):

```typescript
// User clicks "Connect Wallet"
await paraAuth.verifyOAuth('GOOGLE', (url) => {
  window.open(url, '_blank');
});

await paraAuth.waitForLogin();
```

Para creates an embedded wallet for the user, secured by their social account.

### 2. Wallet Retrieval

Once authenticated, the application retrieves the Para wallet:

```typescript
const wallets = await para.getWallets();
const walletsArray = Object.values(wallets);
```

Each wallet contains:

- `id`: Wallet identifier
- `address`: Ethereum-style address
- Other wallet metadata

### 3. Miden Client Initialization

The `miden-para` library bridges Para wallets to Miden:

```typescript
import { createParaMidenClient } from 'miden-para';

const res = await createParaMidenClient(para, wallets, {
  type: AccountType.RegularAccountImmutableCode,
  storageMode: 'public',
  accountSeed: 'plain-example',
});
```

### 4. Account Information

The Miden para sdk gives the accountId for the para account

```typescript
// Miden Account ID (hex format)
const accountId = res.accountId;

// Miden Address (bech32 format for display)
const address = Address.fromAccountId(
  AccountId.fromHex(res.accountId),
  'BasicWallet'
).toBech32(NetworkId.Testnet);
```

Once initialized, the client can perform normal WebClient operations

#### Sync State

```typescript
await client.syncState();
```

#### Check Balances

```typescript
const account = await client.getAccount(AccountId.fromHex(accountId));
const assets = account.vault().fungibleAssets();
```

#### Mint Tokens (Example)

```typescript
// Create a faucet
const faucet = await newClient.newFaucet(
  AccountStorageMode.public(),
  false,
  'MID',
  8,
  BigInt(1_000_000_0000_00),
  0
);

// Mint tokens to account
const mintTxRequest = newClient.newMintTransactionRequest(
  recipientAccount.id(),
  faucet.id(),
  NoteType.Public,
  BigInt(1000) * BigInt(1e8)
);

const txHash = await newClient.submitNewTransaction(faucet.id(), mintTxRequest);
```

#### Consume Notes

```typescript
// Get consumable notes
const notes = await client.getConsumableNotes(account.id());
const noteIds = notes.map((n) => n.inputNoteRecord().id().toString());

// Consume them
const consumeRequest = client.newConsumeTransactionRequest(noteIds);
const txHash = await client.submitNewTransaction(account.id(), consumeRequest);
```

## Project Structure

```
src/
├── lib/
│   ├── client.ts          # Para SDK initialization
│   ├── paraAccount.ts     # Para account state management
│   └── paraAuth.ts        # Para authentication flow
└── main.ts                # Miden integration & UI logic
```

## Setup

1. Set Para API key:

```bash
# Create .env file
VITE_PARA_API_KEY=your_api_key
VITE_PARA_ENVIRONMENT=beta
```

2. Install dependencies:

```bash
yarn install
```

3. Run development server:

```bash
yarn dev
```

4. Build for production:

```bash
yarn build
```

import { para } from "./client";

// State management for Para account
interface ParaAccountState {
  isConnected: boolean;
  address: string;
  isLoading: boolean;
  error: string | null;
}

type StateChangeListener = (state: ParaAccountState) => void;

class ParaAccountManager {
  private state: ParaAccountState = {
    isConnected: false,
    address: "",
    isLoading: false,
    error: null,
  };

  private listeners: Set<StateChangeListener> = new Set();

  getState(): Readonly<ParaAccountState> {
    return { ...this.state };
  }

  subscribe(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(updates: Partial<ParaAccountState>) {
    this.state = { ...this.state, ...updates };
    this.notifyListeners();
  }

  private notifyListeners() {
    const currentState = this.getState();
    this.listeners.forEach((listener) => listener(currentState));
  }

  async checkAuthentication(): Promise<void> {
    this.setState({ isLoading: true, error: null });

    try {
      const isAuthenticated = await para.isFullyLoggedIn();

      if (isAuthenticated) {
        const wallets = Object.values(await para.getWallets());
        this.setState({
          address: wallets?.[0]?.address || "",
          isConnected: true,
          isLoading: false,
        });
      } else {
        this.setState({
          isConnected: false,
          address: "",
          isLoading: false,
        });
      }
    } catch (err) {
      this.setState({
        error:
          err instanceof Error ? err.message : "Failed to check authentication",
        isConnected: false,
        address: "",
        isLoading: false,
      });
    }
  }

  async getWallets(): Promise<any[]> {
    const wallets = await para.getWallets();
    return Object.values(wallets);
  }

  async signMessage(message: string): Promise<any> {
    if (!this.state.isConnected) {
      throw new Error("Not connected");
    }

    const wallets = Object.values(await para.getWallets());
    if (!wallets?.length) {
      throw new Error("No wallet found");
    }

    return await para.signMessage({
      walletId: wallets[0].id,
      messageBase64: btoa(message),
    });
  }
}

export const paraAccount = new ParaAccountManager();

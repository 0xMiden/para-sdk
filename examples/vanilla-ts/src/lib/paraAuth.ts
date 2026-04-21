import { para } from "./client";
import { paraAccount } from "./paraAccount";
import type { AuthState, TOAuthMethod } from "@getpara/web-sdk";

export type AuthStep = "select" | "email" | "phone" | "verify" | "login";

interface AuthModalState {
  isOpen: boolean;
  step: AuthStep;
  activeTab: "email" | "phone";
  email: string;
  countryCode: string;
  phoneNumber: string;
  verificationCode: string;
  selectedOAuthMethod: TOAuthMethod | null;
  isLoading: boolean;
  error: string | null;
}

type StateChangeListener = (state: AuthModalState) => void;

class ParaAuthManager {
  private state: AuthModalState = {
    isOpen: false,
    step: "select",
    activeTab: "email",
    email: "",
    countryCode: "+1",
    phoneNumber: "",
    verificationCode: "",
    selectedOAuthMethod: null,
    isLoading: false,
    error: null,
  };

  private listeners: Set<StateChangeListener> = new Set();

  getState(): Readonly<AuthModalState> {
    return { ...this.state };
  }

  subscribe(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(updates: Partial<AuthModalState>) {
    this.state = { ...this.state, ...updates };
    this.notifyListeners();
  }

  private notifyListeners() {
    const currentState = this.getState();
    this.listeners.forEach((listener) => listener(currentState));
  }

  openModal() {
    this.setState({ isOpen: true });
  }

  closeModal() {
    this.state = {
      isOpen: false,
      step: "select",
      activeTab: "email",
      email: "",
      countryCode: "+1",
      phoneNumber: "",
      verificationCode: "",
      selectedOAuthMethod: null,
      isLoading: false,
      error: null,
    };
    this.notifyListeners();
  }

  setActiveTab(tab: "email" | "phone") {
    this.setState({
      activeTab: tab,
      step: tab === "email" ? "email" : "phone",
      error: null,
    });
  }

  async signUpOrLoginWithEmail(email: string): Promise<AuthState> {
    this.setState({ isLoading: true, error: null });

    try {
      const authState = await para.signUpOrLogIn({ auth: { email } });

      if (authState.stage === "verify") {
        this.setState({ step: "verify", isLoading: false });
      } else if (authState.stage === "login") {
        this.setState({ step: "login", isLoading: false });
      }

      return authState;
    } catch (error) {
      this.setState({
        error: error instanceof Error ? error.message : "Authentication failed",
        isLoading: false,
      });
      throw error;
    }
  }

  async signUpOrLoginWithPhone(
    phoneNumber: string,
    countryCode: string
  ): Promise<AuthState> {
    this.setState({ isLoading: true, error: null });

    try {
      const fullPhoneNumber = `${countryCode}${phoneNumber}` as `+${number}`;
      const authState = await para.signUpOrLogIn({
        auth: { phone: fullPhoneNumber },
      });

      if (authState.stage === "verify") {
        this.setState({ step: "verify", isLoading: false });
      } else if (authState.stage === "login") {
        this.setState({ step: "login", isLoading: false });
      }

      return authState;
    } catch (error) {
      this.setState({
        error: error instanceof Error ? error.message : "Authentication failed",
        isLoading: false,
      });
      throw error;
    }
  }

  async verifyAccount(verificationCode: string): Promise<AuthState> {
    this.setState({ isLoading: true, error: null });

    try {
      const authState = await para.verifyNewAccount({ verificationCode });
      this.setState({ isLoading: false });
      return authState;
    } catch (error) {
      this.setState({
        error:
          error instanceof Error &&
          error.message === "Invalid verification code"
            ? "Verification code incorrect or expired"
            : error instanceof Error
            ? error.message
            : "Verification failed",
        isLoading: false,
      });
      throw error;
    }
  }

  async verifyOAuth(
    method: TOAuthMethod,
    onOAuthUrl: (url: string) => void,
    isCanceled?: () => boolean
  ): Promise<AuthState> {
    this.setState({
      isLoading: true,
      error: null,
      selectedOAuthMethod: method,
    });

    try {
      let authState: AuthState;

      if (method === "FARCASTER") {
        authState = await para.verifyFarcaster({
          onConnectUri: onOAuthUrl,
          isCanceled,
        });
      } else {
        authState = await para.verifyOAuth({
          method: method as Exclude<TOAuthMethod, "TELEGRAM" | "FARCASTER">,
          onOAuthUrl,
          isCanceled,
        });
      }

      this.setState({ isLoading: false, selectedOAuthMethod: null });
      return authState;
    } catch (error) {
      this.setState({
        error:
          error instanceof Error
            ? error.message
            : "OAuth authentication failed",
        isLoading: false,
        selectedOAuthMethod: null,
      });
      throw error;
    }
  }

  async waitForLogin(isCanceled?: () => boolean) {
    const result = await para.waitForLogin({ isCanceled });

    if (result.needsWallet) {
      await para.createWallet({ skipDistribute: false });
    }

    await paraAccount.checkAuthentication();
    this.closeModal();

    return result;
  }

  async waitForWalletCreation(isCanceled?: () => boolean) {
    const result = await para.waitForWalletCreation({ isCanceled });
    await paraAccount.checkAuthentication();
    this.closeModal();

    return result;
  }

  async logout() {
    this.setState({ isLoading: true, error: null });

    try {
      await para.logout();
      await paraAccount.checkAuthentication();
      this.closeModal();
    } catch (error) {
      this.setState({
        error: error instanceof Error ? error.message : "Failed to logout",
        isLoading: false,
      });
      throw error;
    }
  }
}

export const paraAuth = new ParaAuthManager();

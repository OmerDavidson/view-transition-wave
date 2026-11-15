/** The small part of Google Identity Services (accounts.google.com/gsi/client) this app uses. */
interface GoogleIdentity {
  initialize(config: {
    client_id: string;
    callback: (response: { credential: string }) => void;
    ux_mode?: 'popup' | 'redirect';
    auto_select?: boolean;
    itp_support?: boolean;
    use_fedcm_for_button?: boolean;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: { type?: 'standard' | 'icon'; theme?: 'outline' | 'filled_blue' | 'filled_black'; size?: 'large' | 'medium'; text?: 'signin_with' | 'continue_with'; shape?: 'pill' | 'rectangular'; width?: number; logo_alignment?: 'left' | 'center' },
  ): void;
  disableAutoSelect(): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentity } };
  }
}

const SCRIPT_URL = 'https://accounts.google.com/gsi/client';
let loading: Promise<GoogleIdentity> | null = null;

/** Loads Google's sign-in script once. It's only needed on the sign-in screen, so it isn't part of the offline app. */
export function loadGoogleIdentity(): Promise<GoogleIdentity> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  loading ??= new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.addEventListener('load', () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('Google sign-in did not load'))));
    script.addEventListener('error', () => reject(new Error('Google sign-in did not load')));
    document.head.append(script);
  }).catch((error: unknown) => {
    loading = null; // try again next time
    throw error;
  });
  return loading;
}

/** After signing out, don't sign the same account straight back in. */
export function disableGoogleAutoSelect(): void {
  window.google?.accounts?.id?.disableAutoSelect();
}

import React, { useState, useCallback, useMemo } from 'react';
import { clsx } from 'clsx';
import { Check, ArrowRight, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from '@/router/useRouter';
import { APP_VERSION } from '@/utils/constants';
import { Input } from '@/components/ui/Input';
import { HivaLogo } from '@/components/ui/HivaLogo';

const SERVER_CODE_RE = /^HIVA-[A-Z0-9]{4}$/;

const LoginScreen: React.FC = () => {
  const { login } = useAuth();
  const { navigate } = useRouter();

  const [serverCode, setServerCode] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const serverCodeError = useMemo(() => {
    if (!serverCode) return null;
    return SERVER_CODE_RE.test(serverCode) ? null : 'Invalid format. Use HIVA-XXXX.';
  }, [serverCode]);

  const accessKeyError = useMemo(() => {
    if (!accessKey) return null;
    return /^[A-Z0-9]{4}$/.test(accessKey) ? null : 'Must be 4 characters.';
  }, [accessKey]);

  const handleSubmit = useCallback(async () => {
    setError(null);

    // Client-side format guard — access key must match last 4 of server code
    if (!SERVER_CODE_RE.test(serverCode)) {
      setError('Invalid code format');
      return;
    }
    if (accessKey !== serverCode.split('-')[1]) {
      setError('Access key must match the last 4 characters of your server code');
      return;
    }

    setIsLoading(true);
    const result = await login(serverCode, accessKey);
    setIsLoading(false);

    if (result.success) {
      setIsSuccess(true);
      setTimeout(() => navigate('/chat'), 800);
    } else {
      setError(result.error ?? 'Connection failed. Please try again.');
    }
  }, [serverCode, accessKey, login, navigate]);

  return (
    <div className="relative flex flex-col items-center justify-center h-full px-4 noise-overlay bg-gradient-to-b from-accent-600 to-accent-800">
      {/* Logo */}
      <div className="flex flex-col items-center mb-8">
        <HivaLogo size={64} className="mb-4" />
        <h1 className="font-display font-bold text-4xl text-white tracking-tight">
          HIVA
        </h1>
        <p className="font-mono text-[11px] text-brand-tan tracking-[0.15em] mt-1 uppercase">
          Clinical AI · Offline Ready
        </p>
      </div>

      {/* Form */}
      <div className="w-full max-w-sm space-y-4">
        <p className="text-center text-[11px] font-body text-white/70 uppercase tracking-widest">
          Enter code from your supervisor
        </p>

        <Input
          label="Server Code"
          value={serverCode}
          onChange={setServerCode}
          placeholder="HIVA–XXXX"
          autoCapitalize
          error={serverCodeError}
        />

        <Input
          label="Access Key"
          value={accessKey}
          onChange={setAccessKey}
          placeholder="XXXX"
          type="password"
          autoCapitalize
          error={accessKeyError}
        />

        {error && (
          <div className="px-3 py-2 rounded-lg bg-error/15 border border-error/30">
            <p className="text-xs font-body text-error text-center">{error}</p>
          </div>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={isLoading || isSuccess}
          className={clsx(
            'w-full h-14 rounded-xl font-display font-semibold text-base',
            'flex items-center justify-center gap-2',
            'transition-all duration-300',
            isSuccess
              ? 'bg-success text-white'
              : 'bg-white text-accent-600 hover:bg-n-50 active:scale-[0.97]',
            (isLoading || isSuccess) && 'opacity-90 cursor-not-allowed'
          )}
        >
          {isSuccess ? (
            <>
              <Check className="w-5 h-5" />
              Connected
            </>
          ) : isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Connecting…
            </>
          ) : (
            <>
              Connect to HIVA
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>

      {/* Footer */}
      <div className="absolute bottom-8 text-center">
        <p className="text-[10px] font-body text-white/50">
          v{APP_VERSION} · HIVA Certified · Offline Ready
        </p>
      </div>
    </div>
  );
};

export default LoginScreen;

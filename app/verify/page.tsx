'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { applyActionCode } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Sparkles, CheckCircle2, XCircle, Loader2, ArrowRight, ShieldCheck, Cpu } from 'lucide-react';
import { motion } from 'framer-motion';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const oobCode = searchParams.get('oobCode');
    const mode = searchParams.get('mode');

    if (!oobCode) {
      setStatus('error');
      setErrorMsg('No verification code was provided. Please request a new link from the app.');
      return;
    }

    const verifyCode = async () => {
      try {
        await applyActionCode(auth, oobCode);
        setStatus('success');
      } catch (err: any) {
        console.error('Email verification error:', err);
        setStatus('error');
        setErrorMsg(err.message || 'This verification link has expired or has already been used.');
      }
    };

    verifyCode();
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-[#050508] text-white flex items-center justify-center relative overflow-hidden px-4">
      {/* 🔮 Background Futuristic Glow Elements */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(168,85,247,0.15),transparent_50%)] pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_80%,rgba(59,130,246,0.08),transparent_40%)] pointer-events-none" />
      
      {/* Subtle Digital Grid Pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.005)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.005)_1px,transparent_1px)] bg-[size:30px_30px] pointer-events-none" />

      {/* Floating Glowing Core behind card */}
      <motion.div 
        animate={{
          scale: [1, 1.15, 1],
          opacity: [0.3, 0.6, 0.3],
        }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        className="absolute w-80 h-80 rounded-full bg-purple-500/10 blur-[80px] pointer-events-none"
      />

      {/* 🚀 Main Interface Card */}
      <motion.div 
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md bg-[#0c0c0f]/80 backdrop-blur-2xl border border-white/10 rounded-2xl p-8 text-center shadow-[0_0_50px_rgba(168,85,247,0.05)] relative z-10 overflow-hidden"
      >
        {/* Neon laser header accent line */}
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-purple-500 to-transparent shadow-[0_0_10px_rgba(168,85,247,0.5)]" />

        {/* ── 1. LOADING STATE ── */}
        {status === 'loading' && (
          <div className="flex flex-col items-center py-6">
            <div className="w-16 h-16 rounded-full bg-purple-500/5 border border-purple-500/20 flex items-center justify-center relative mb-6 shadow-[0_0_20px_rgba(168,85,247,0.05)]">
              <Loader2 className="animate-spin text-purple-400" size={32} />
              <div className="absolute inset-0 rounded-full border border-purple-500/40 animate-ping opacity-20" />
            </div>
            
            <h2 className="text-lg font-bold font-mono tracking-wider text-white uppercase mb-2">
              Validating Security Keys
            </h2>
            <p className="text-xs text-gray-400 leading-relaxed font-sans max-w-xs">
              Connecting to Firebase authentication nodes to verify your workspace permission...
            </p>
          </div>
        )}

        {/* ── 2. SUCCESS STATE ── */}
        {status === 'success' && (
          <div className="flex flex-col items-center">
            {/* Pulsing neon check circle */}
            <div className="w-20 h-20 rounded-full bg-emerald-500/5 border border-emerald-500/30 flex items-center justify-center relative mb-6 shadow-[0_0_30px_rgba(16,185,129,0.1)]">
              <CheckCircle2 className="text-emerald-400" size={40} />
              <motion.div 
                animate={{ scale: [1, 1.3, 1], opacity: [0.4, 0, 0.4] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="absolute inset-0 rounded-full border-2 border-emerald-500/30"
              />
            </div>

            <h2 className="text-xl font-bold font-mono tracking-widest text-emerald-400 uppercase mb-3">
              Access Authorized
            </h2>
            <p className="text-xs text-gray-300 leading-relaxed font-sans mb-8 max-w-xs">
              Your email address has been verified successfully. Your TurboLearn AI workspace is now unlocked.
            </p>

            {/* Futuristic Action Buttons */}
            <div className="w-full flex flex-col gap-3">
              {/* Mobile App Launcher */}
              <a 
                href="turbolearn://" 
                className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold font-mono uppercase tracking-widest py-3.5 px-6 rounded-xl transition-all shadow-[0_0_20px_rgba(168,85,247,0.25)] hover:shadow-[0_0_30px_rgba(168,85,247,0.4)] flex items-center justify-center gap-2 group border border-purple-400/20"
              >
                <Cpu size={14} className="group-hover:rotate-12 transition-transform" />
                Launch Mobile App
                <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
              </a>

              {/* Web Portal Link */}
              <button 
                onClick={() => router.push('/')}
                className="w-full bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white text-xs font-semibold font-mono uppercase tracking-widest py-3 px-6 rounded-xl transition-all border border-white/10"
              >
                Go to Web Dashboard
              </button>
            </div>
          </div>
        )}

        {/* ── 3. ERROR STATE ── */}
        {status === 'error' && (
          <div className="flex flex-col items-center">
            {/* Warning neon circle */}
            <div className="w-20 h-20 rounded-full bg-red-500/5 border border-red-500/30 flex items-center justify-center relative mb-6 shadow-[0_0_30px_rgba(239,68,68,0.1)]">
              <XCircle className="text-red-400" size={40} />
            </div>

            <h2 className="text-xl font-bold font-mono tracking-widest text-red-400 uppercase mb-3">
              Link Expired
            </h2>
            
            <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-4 mb-8 w-full">
              <p className="text-xs text-red-300 font-mono leading-relaxed break-words">
                {errorMsg}
              </p>
            </div>

            <button 
              onClick={() => router.push('/')}
              className="w-full bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white text-xs font-semibold font-mono uppercase tracking-widest py-3.5 px-6 rounded-xl transition-all border border-white/10"
            >
              Return to Homepage
            </button>
          </div>
        )}
      </motion.div>

      {/* Futuristic footer metadata */}
      <div className="absolute bottom-6 left-0 right-0 text-center pointer-events-none opacity-20">
        <span className="text-[9px] font-mono tracking-widest uppercase text-gray-400 flex items-center justify-center gap-1.5">
          <ShieldCheck size={10} /> Secure Node Verification Session // v1.0.0
        </span>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#050508] text-white flex items-center justify-center font-mono text-xs uppercase tracking-widest">
        Initializing Security Node...
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  );
}

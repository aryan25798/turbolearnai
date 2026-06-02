'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { applyActionCode } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Sparkles, CheckCircle2, XCircle, Loader2, ArrowRight, ShieldCheck, Cpu, Terminal, RefreshCw } from 'lucide-react';
import { motion } from 'framer-motion';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [diagnosticLine, setDiagnosticLine] = useState('Initializing verification node...');

  // Diagnostic loading text logs to make it feel like a real cyber authentication portal
  useEffect(() => {
    if (status !== 'loading') return;
    const lines = [
      'Locating auth parameters...',
      'Opening secure Firebase handshake channel...',
      'Verifying token signature...',
      'Authorizing portal clearance...',
    ];
    let i = 0;
    const timer = setInterval(() => {
      if (i < lines.length) {
        setDiagnosticLine(lines[i]);
        i++;
      } else {
        clearInterval(timer);
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    const oobCode = searchParams.get('oobCode');
    const mode = searchParams.get('mode');

    if (!oobCode) {
      setStatus('error');
      setErrorMsg('No verification authorization token was detected in the payload URL.');
      return;
    }

    const verifyCode = async () => {
      // Intentionally add a slight delay so the user experiences the gorgeous loading cyber animation
      await new Promise(resolve => setTimeout(resolve, 2400));
      try {
        await applyActionCode(auth, oobCode);
        setStatus('success');
      } catch (err: any) {
        console.error('Email verification error:', err);
        setStatus('error');
        setErrorMsg(err.message || 'The verification link has expired, or has already been checked by another security node.');
      }
    };

    verifyCode();
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-[#030306] text-white flex items-center justify-center relative overflow-hidden px-4 sm:px-6 py-12 select-none">
      
      {/* 🔮 Futuristic Backlighting Radial Orbs */}
      <motion.div 
        animate={{
          scale: status === 'success' ? [1, 1.3, 1] : status === 'error' ? [1, 1.1, 1] : [1, 1.25, 1],
          x: status === 'success' ? [0, 60, 0] : [0, 40, 0],
          y: status === 'success' ? [0, -40, 0] : [0, -30, 0],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        className={`absolute top-1/4 left-1/4 w-[300px] sm:w-[500px] h-[300px] sm:h-[500px] rounded-full blur-[100px] sm:blur-[130px] pointer-events-none transition-colors duration-1000 ${
          status === 'success' ? 'bg-emerald-600/15' : status === 'error' ? 'bg-red-600/10' : 'bg-purple-600/10'
        }`}
      />
      <motion.div 
        animate={{
          scale: [1.2, 1, 1.2],
          x: [0, -40, 0],
          y: [0, 30, 0],
        }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
        className={`absolute bottom-1/4 right-1/4 w-[280px] sm:w-[450px] h-[280px] sm:h-[450px] rounded-full blur-[100px] sm:blur-[130px] opacity-10 pointer-events-none transition-colors duration-1000 ${
          status === 'success' ? 'bg-teal-500/80' : status === 'error' ? 'bg-rose-500/80' : 'bg-blue-600/80'
        }`}
      />

      {/* Cyber Grid Lines Overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.005)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.005)_1px,transparent_1px)] bg-[size:30px_30px] sm:bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_60%,transparent_100%)] pointer-events-none" />

      {/* Scanning Laser Line Overlay */}
      <div className="absolute inset-0 w-full h-full pointer-events-none overflow-hidden">
        <motion.div 
          animate={{ y: ["0%", "100%", "0%"] }}
          transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
          className="w-full h-[1px] bg-gradient-to-r from-transparent via-purple-500/10 to-transparent shadow-[0_0_10px_rgba(168,85,247,0.05)]"
        />
      </div>

      {/* 🚀 Central Sci-Fi Terminal Card */}
      <motion.div 
        initial={{ opacity: 0, y: 30, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className={`w-full max-w-md bg-[#08080c]/85 backdrop-blur-2xl border rounded-2xl p-6 sm:p-8 text-center shadow-[0_0_50px_rgba(0,0,0,0.8)] relative z-10 overflow-hidden transition-all duration-700 ${
          status === 'success' ? 'shadow-emerald-500/5 border-emerald-500/30' : 
          status === 'error' ? 'shadow-red-500/5 border-red-500/30' : 
          'shadow-purple-500/5 border-purple-500/20'
        }`}
      >
        {/* Dynamic laser header color shifting depending on status */}
        <div className={`absolute top-0 inset-x-0 h-[2px] transition-all duration-700 ${
          status === 'success' ? 'bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_15px_rgba(16,185,129,0.8)]' : 
          status === 'error' ? 'bg-gradient-to-r from-transparent via-red-500 to-transparent shadow-[0_0_15px_rgba(239,68,68,0.8)]' : 
          'bg-gradient-to-r from-transparent via-purple-500 to-transparent shadow-[0_0_15px_rgba(168,85,247,0.8)]'
        }`} />

        {/* Cyberpunk corner decors */}
        <div className={`absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 rounded-tl-md transition-colors duration-500 ${
          status === 'success' ? 'border-emerald-500/50' : status === 'error' ? 'border-red-500/50' : 'border-purple-500/30'
        }`} />
        <div className={`absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 rounded-tr-md transition-colors duration-500 ${
          status === 'success' ? 'border-emerald-500/50' : status === 'error' ? 'border-red-500/50' : 'border-purple-500/30'
        }`} />
        <div className={`absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 rounded-bl-md transition-colors duration-500 ${
          status === 'success' ? 'border-emerald-500/50' : status === 'error' ? 'border-red-500/50' : 'border-purple-500/30'
        }`} />
        <div className={`absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 rounded-br-md transition-colors duration-500 ${
          status === 'success' ? 'border-emerald-500/50' : status === 'error' ? 'border-red-500/50' : 'border-purple-500/30'
        }`} />

        {/* Logo/Identity Group */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center gap-1.5 px-3 py-1 bg-white/[0.02] border border-white/[0.05] rounded-full mb-3">
            <Cpu size={11} className={`animate-pulse ${status === 'success' ? 'text-emerald-400' : status === 'error' ? 'text-red-400' : 'text-purple-400'}`} />
            <span className="text-[9px] font-mono tracking-[3px] uppercase text-gray-400">
              Security Node // Core-v1.0
            </span>
          </div>
          <h1 className="text-xl font-black font-mono tracking-[6px] text-transparent bg-clip-text bg-gradient-to-r from-white via-white to-purple-400 uppercase select-none">
            TURBOLEARN
          </h1>
        </div>

        {/* ── 1. LOADING STATE ── */}
        {status === 'loading' && (
          <div className="flex flex-col items-center py-4">
            {/* Spinning Concentric Cyber Rings */}
            <div className="w-24 h-24 rounded-full border border-white/5 flex items-center justify-center relative mb-8">
              <Loader2 className="animate-spin text-purple-500" size={32} />
              
              {/* Outer pulsing ring */}
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                className="absolute inset-1.5 rounded-full border-t border-b border-purple-400/30 border-l-transparent border-r-transparent"
              />
              <motion.div 
                animate={{ rotate: -360 }}
                transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
                className="absolute inset-3 rounded-full border-l border-r border-blue-400/20 border-t-transparent border-b-transparent"
              />
            </div>
            
            <h2 className="text-xs font-bold font-mono tracking-widest text-gray-300 uppercase mb-3">
              Validating Handshake Token
            </h2>
            
            {/* Live Terminal Log line */}
            <div className="w-full bg-[#050508]/80 border border-white/5 rounded-xl py-3 px-4 flex items-center justify-center gap-2.5 mb-2 max-w-[280px]">
              <Terminal size={12} className="text-purple-400 shrink-0" />
              <span className="text-[10px] font-mono text-purple-400/80 truncate text-center">
                {diagnosticLine}
              </span>
            </div>
          </div>
        )}

        {/* ── 2. SUCCESS STATE ── */}
        {status === 'success' && (
          <div className="flex flex-col items-center">
            {/* Neon Success Portal Ring */}
            <div className="w-24 h-24 rounded-full border border-emerald-500/20 bg-emerald-500/5 flex items-center justify-center relative mb-6 shadow-[0_0_30px_rgba(16,185,129,0.1)]">
              <CheckCircle2 className="text-emerald-400" size={40} />
              
              {/* Spinning accent success indicators */}
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                className="absolute inset-1.5 rounded-full border border-dashed border-emerald-500/30"
              />
              <motion.div 
                animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0, 0.3] }}
                transition={{ duration: 2.5, repeat: Infinity }}
                className="absolute inset-0 rounded-full border border-emerald-500/40"
              />
            </div>

            <h2 className="text-sm font-bold font-mono tracking-[4px] text-emerald-400 uppercase mb-2">
              Identity Verified
            </h2>
            <p className="text-xs text-gray-400 leading-relaxed max-w-[310px] mb-6">
              Clearance credentials confirmed. Cyber link established. You can now launch the console or mobile workspace.
            </p>

            {/* Session stats board */}
            <div className="w-full bg-white/[0.01] border border-white/[0.05] rounded-xl p-3 mb-6 text-left font-mono text-[9px] text-gray-500 space-y-1">
              <div className="flex justify-between"><span className="text-gray-600">HANDSHAKE:</span> <span className="text-emerald-400/80 font-semibold">SUCCESS_SECURE</span></div>
              <div className="flex justify-between"><span className="text-gray-600">ENCRYPTION:</span> <span className="text-gray-400">AES_256_GCM</span></div>
              <div className="flex justify-between"><span className="text-gray-600">SIGNATURE:</span> <span className="text-gray-400">HMAC-SHA256</span></div>
              <div className="flex justify-between"><span className="text-gray-600">GATEWAY:</span> <span className="text-purple-400/80">VERIFY-NODE-ALPHA</span></div>
            </div>

            {/* Glowing Action Buttons */}
            <div className="w-full flex flex-col sm:flex-row gap-3">
              {/* Mobile app link */}
              <motion.a 
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                href="turbolearn://" 
                className="flex-1 bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-[10px] sm:text-xs font-bold font-mono uppercase tracking-widest py-3 px-4 rounded-xl transition-all shadow-[0_0_20px_rgba(124,58,237,0.25)] hover:shadow-[0_0_30px_rgba(124,58,237,0.4)] border border-purple-400/20 flex items-center justify-center gap-1.5 group cursor-pointer"
              >
                <Cpu size={13} className="group-hover:rotate-12 transition-transform duration-300" />
                App launch
                <ArrowRight size={12} className="group-hover:translate-x-0.5 transition-transform duration-300" />
              </motion.a>

              {/* Web platform button */}
              <motion.button 
                whileHover={{ backgroundColor: "rgba(255,255,255,0.08)", scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => router.push('/')}
                className="flex-1 bg-white/5 text-gray-300 hover:text-white text-[10px] sm:text-xs font-bold font-mono uppercase tracking-widest py-3 px-4 rounded-xl transition-all border border-white/10"
              >
                Web Console
              </motion.button>
            </div>
          </div>
        )}

        {/* ── 3. ERROR STATE ── */}
        {status === 'error' && (
          <div className="flex flex-col items-center">
            {/* Warning Portal Ring */}
            <div className="w-24 h-24 rounded-full border border-red-500/20 bg-red-500/5 flex items-center justify-center relative mb-6 shadow-[0_0_30px_rgba(239,68,68,0.1)]">
              <XCircle className="text-red-400" size={40} />
              
              <motion.div 
                animate={{ rotate: -360 }}
                transition={{ duration: 5, repeat: Infinity, ease: "linear" }}
                className="absolute inset-1.5 rounded-full border border-dashed border-red-500/30"
              />
            </div>

            <h2 className="text-sm font-bold font-mono tracking-[4px] text-red-500 uppercase mb-2">
              Clearance Failed
            </h2>
            
            {/* Error Message Box */}
            <div className="bg-[#150a0d] border border-red-950/30 rounded-xl p-4 mb-6 w-full">
              <p className="text-[10px] text-red-400/90 font-mono leading-relaxed break-words text-center">
                {errorMsg}
              </p>
            </div>

            <motion.button 
              whileHover={{ backgroundColor: "rgba(255,255,255,0.08)" }}
              whileTap={{ scale: 0.98 }}
              onClick={() => router.push('/')}
              className="w-full bg-white/5 text-gray-300 hover:text-white text-[10px] sm:text-xs font-bold font-mono uppercase tracking-widest py-3.5 px-6 rounded-xl transition-all border border-white/10"
            >
              Back to Security Portal
            </motion.button>
          </div>
        )}
      </motion.div>

      {/* Cyber Security footer tracking details */}
      <div className="absolute bottom-6 left-0 right-0 text-center pointer-events-none opacity-20">
        <span className="text-[8px] sm:text-[9px] font-mono tracking-[3px] uppercase text-gray-500 flex items-center justify-center gap-1.5">
          <ShieldCheck size={11} className="text-purple-400/80" /> Cryptographic clearance match verified
        </span>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#030306] text-white flex items-center justify-center font-mono text-xs uppercase tracking-widest gap-2">
        <RefreshCw className="animate-spin text-purple-500" size={14} /> Initializing Authentication Node...
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  );
}

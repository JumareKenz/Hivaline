/**
 * ChatScreen — main conversational interface
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import { Volume2, VolumeX } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useHIVFile } from '@/hooks/useHIVFile';
import { useConversation } from '@/hooks/useConversation';
import { TopBar } from '@/components/ui/TopBar';
import { StatusPill } from '@/components/ui/StatusPill';
import { HivaLogo } from '@/components/ui/HivaLogo';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { TypingIndicator } from './TypingIndicator';
import { SuggestionChips } from './SuggestionChips';
import { VoiceToast } from './VoiceToast';
import { useVoiceService } from '@/hooks/useVoiceService';
import { useTTS } from '@/hooks/useTTS';
import type { ChatMessage } from '@/types/hiv';
import { formatDate } from '@/utils/formatters';

const SUGGESTIONS = [
  'What can you do?',
  'How do you work offline?',
  'How do I get updates?',
  'What is my access code?',
  'How do I search for answers?',
];

const WELCOME_MESSAGES = [
  'Good morning',
  'Good afternoon',
  'Good evening',
];

const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return WELCOME_MESSAGES[0];
  if (hour < 17) return WELCOME_MESSAGES[1];
  return WELCOME_MESSAGES[2];
};

const ChatScreen: React.FC = () => {
  const { state: authState } = useAuth();
  const { file } = useHIVFile();
  const { respond } = useConversation(file);
  const voice = useVoiceService();
  const { isEnabled: ttsEnabled, isAvailable: ttsAvailable, speak: ttsSpeak, cancel: ttsCancel, toggleEnabled: toggleTTS } = useTTS();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [typingText, setTypingText] = useState('');
  const [suggestedChips, setSuggestedChips] = useState<string[]>([]);
  const [showVoiceToast, setShowVoiceToast] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const userName = authState.user?.name ?? 'Health Worker';

  // Show voice toast when voice state changes
  useEffect(() => {
    if (voice.state !== 'idle' || voice.error) {
      setShowVoiceToast(true);
    }
  }, [voice.state, voice.error]);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;
    ttsCancel();
    setSuggestedChips([]);

    // Clear any existing typing animation
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-user`,
      type: 'text',
      sender: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setIsTyping(true);
    setTypingText('');

    // Get response from conversation engine
    const result = await respond(text);

    // Calculate typing delay based on response length
    const typingDelay = Math.min(600, 400 + result.message.length * 8);

    // Start typing animation
    const chars = result.message.split('');
    let currentIndex = 0;
    const charsPerTick = 30;

    const animateTyping = () => {
      const endIndex = Math.min(currentIndex + charsPerTick, chars.length);
      const visibleText = chars.slice(0, endIndex).join('');
      setTypingText(visibleText);
      currentIndex = endIndex;

      if (currentIndex < chars.length) {
        typingTimeoutRef.current = setTimeout(animateTyping, 30);
      } else {
        // Animation complete — show final message
        setIsTyping(false);
        setTypingText('');
        const hivaMsg: ChatMessage = {
          id: `msg-${Date.now()}-hiva`,
          type: result.type === 'urgent' ? 'danger_sign' : 'text',
          sender: 'hiva',
          content: result.message,
          timestamp: new Date(),
          metadata: result.chunkId
            ? {
                artifactId: result.chunkId,
                source: result.source?.document,
              }
            : undefined,
        };
        setMessages((prev) => [...prev, hivaMsg]);
        setSuggestedChips(result.suggestedFollowUps);
      }
    };

    // Start after initial delay
    typingTimeoutRef.current = setTimeout(animateTyping, typingDelay);
  }, [respond, ttsCancel]);

  const handleSend = useCallback(() => {
    sendMessage(inputValue);
  }, [inputValue, sendMessage]);

  const handleSuggestion = useCallback((text: string) => {
    sendMessage(text);
  }, [sendMessage]);

  // Handle voice transcript — placed after sendMessage to avoid TDZ
  const lastTranscriptRef = useRef<string | null>(null);
  useEffect(() => {
    if (voice.transcript && voice.transcript !== lastTranscriptRef.current && voice.state === 'idle') {
      lastTranscriptRef.current = voice.transcript;
      sendMessage(voice.transcript);
    }
  }, [voice.transcript, voice.state, sendMessage]);

  // Auto-speak HIVA responses
  const spokenIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.sender === 'hiva' && ttsEnabled && ttsAvailable) {
      if (!spokenIds.current.has(lastMsg.id)) {
        spokenIds.current.add(lastMsg.id);
        ttsSpeak(lastMsg.content);
      }
    }
  }, [messages, ttsEnabled, ttsAvailable, ttsSpeak]);

  // Cancel TTS on unmount
  useEffect(() => {
    return () => {
      ttsCancel();
    };
  }, [ttsCancel]);

  const hasMessages = messages.length > 0;

  const handleVoiceDismiss = useCallback(() => {
    setShowVoiceToast(false);
    voice.reset();
  }, [voice]);

  // Cleanup typing timeout on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="flex flex-col h-full bg-bg-secondary relative">
      {/* Voice toast overlay */}
      {showVoiceToast && (
        <VoiceToast
          state={voice.state}
          error={voice.error}
          onDismiss={handleVoiceDismiss}
        />
      )}

      {!file && (
        <div className="mx-4 mt-3 p-3 rounded-xl bg-warning/10 border border-warning/20 flex items-start gap-2">
          <span className="text-warning text-xs leading-relaxed">
            No clinical data loaded. Log in and check Settings to download the latest guidelines.
          </span>
        </div>
      )}

      <TopBar
        title="HIVA"
        subtitle="Clinical AI · Always available"
        rightElement={
          <div className="flex items-center gap-2">
            {ttsAvailable && (
              <button
                type="button"
                onClick={toggleTTS}
                aria-label={ttsEnabled ? 'Turn off voice' : 'Turn on voice'}
                aria-pressed={ttsEnabled}
                className={clsx(
                  'flex items-center justify-center w-9 h-9 rounded-lg',
                  'transition-colors duration-150',
                  ttsEnabled
                    ? 'bg-accent-600 text-white'
                    : 'bg-n-100 text-n-500 hover:bg-n-200 dark:bg-n-800 dark:text-n-400 dark:hover:bg-n-700'
                )}
              >
                {ttsEnabled ? (
                  <Volume2 className="w-4 h-4" />
                ) : (
                  <VolumeX className="w-4 h-4" />
                )}
              </button>
            )}
            <StatusPill />
          </div>
        }
      />

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <AnimatePresence>
          {!hasMessages && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center justify-center min-h-[50vh] text-center"
            >
              {/* Floating HIVA logo */}
              <div className="relative mb-6">
                <HivaLogo size={80} animate className="shadow-xl" />
              </div>

              <h2 className="font-display font-semibold text-xl text-n-900 dark:text-n-100 mb-1">
                {getGreeting()}, {userName} 👋
              </h2>
              <p className="font-body text-sm text-n-500 dark:text-n-400 max-w-xs mb-6">
                I&apos;m HIVA, your offline clinical assistant. What&apos;s on your mind today?
              </p>

              <SuggestionChips suggestions={SUGGESTIONS} onSelect={handleSuggestion} />
            </motion.div>
          )}

          {messages.map((msg, index) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <MessageBubble message={msg} />
              <div className={clsx(
                'text-[10px] font-body text-n-400 mt-1',
                msg.sender === 'user' ? 'text-right pr-2' : 'text-left pl-2'
              )}>
                {formatDate(msg.timestamp)}
              </div>
            </motion.div>
          ))}

          {isTyping && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {typingText ? (
                <MessageBubble
                  message={{
                    id: 'typing-preview',
                    type: 'text',
                    sender: 'hiva',
                    content: typingText,
                    timestamp: new Date(),
                  }}
                />
              ) : (
                <TypingIndicator />
              )}
            </motion.div>
          )}

          {/* Follow-up suggestion chips */}
          {suggestedChips.length > 0 && !isTyping && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="pl-2"
            >
              <SuggestionChips
                suggestions={suggestedChips}
                onSelect={handleSuggestion}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex-shrink-0">
        <ChatInput
          value={inputValue}
          onChange={setInputValue}
          onSend={handleSend}
          disabled={isTyping}
          voiceState={voice.state}
          onVoiceStart={voice.startRecording}
          onVoiceStop={voice.stopRecording}
        />
      </div>
    </div>
  );
};

export default ChatScreen;

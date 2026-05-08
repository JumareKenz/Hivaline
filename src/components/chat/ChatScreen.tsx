/**
 * ChatScreen — main conversational interface
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import { useSearch } from '@/hooks/useSearch';
import { useAuth } from '@/hooks/useAuth';
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
  'ACT dose for 12kg child',
  'Signs of severe malaria',
  'ANC first visit',
  'Child has convulsions',
  'Pneumonia assessment',
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
  const { searchResponse } = useSearch();
  const voice = useVoiceService();
  const { isEnabled: ttsEnabled, isAvailable: ttsAvailable, speak: ttsSpeak, cancel: ttsCancel } = useTTS();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showVoiceToast, setShowVoiceToast] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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

    // Minimum 300ms delay for perceived confidence
    const startTime = Date.now();
    const result = await searchResponse(text);
    const elapsed = Date.now() - startTime;
    const delay = Math.max(300 - elapsed, 50);

    setTimeout(() => {
      const hivaMsg: ChatMessage = {
        id: `msg-${Date.now()}-hiva`,
        type: result.response.type,
        sender: 'hiva',
        content: result.response.content,
        timestamp: new Date(),
        metadata: result.response.metadata,
      };
      setMessages((prev) => [...prev, hivaMsg]);

      // Append related suggestions as a system chip message
      if (result.related && result.related.length > 0) {
        const relatedMsg: ChatMessage = {
          id: `msg-${Date.now()}-related`,
          type: 'system',
          sender: 'hiva',
          content: '',
          timestamp: new Date(),
          metadata: {
            related: result.related.map((r) => r.preview).join(' · '),
          },
        };
        setMessages((prev) => [...prev, relatedMsg]);
      }

      setIsTyping(false);
    }, delay);
  }, [searchResponse, ttsCancel]);

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

      <TopBar
        title="HIVA"
        subtitle="Clinical AI · Always available"
        rightElement={<StatusPill />}
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
                {getGreeting()}, {userName.split(' ').pop()} 👋
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
              <TypingIndicator />
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

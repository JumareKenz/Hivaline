/**
 * BottomTabBar — glassmorphic sticky navigation
 */

import React, { useCallback } from 'react';
import { clsx } from 'clsx';
import { MessageCircle, BookOpen, Settings } from 'lucide-react';
import { useRouter } from '@/router/useRouter';

interface BottomTabBarProps {
  activeTab: 'chat' | 'knowledge' | 'settings';
}

const TABS = [
  { id: 'chat' as const, label: 'Chat', icon: MessageCircle, path: '/chat' },
  { id: 'knowledge' as const, label: 'Knowledge', icon: BookOpen, path: '/knowledge' },
  { id: 'settings' as const, label: 'Settings', icon: Settings, path: '/settings' },
] as const;

const BottomTabBar: React.FC<BottomTabBarProps> = ({ activeTab }) => {
  const { navigate } = useRouter();

  const handleTabPress = useCallback((path: string) => {
    navigate(path);
  }, [navigate]);

  return (
    <nav
      className={clsx(
        'glass border-t border-n-200/50 dark:border-n-700/50',
        'pb-[env(safe-area-inset-bottom)]'
      )}
    >
      <div className="flex items-center justify-around h-16">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabPress(tab.path)}
              className={clsx(
                'flex flex-col items-center justify-center',
                'w-20 h-full gap-1',
                'transition-colors duration-200',
                isActive ? 'text-accent-600' : 'text-n-400 dark:text-n-500'
              )}
            >
              <Icon className="w-[22px] h-[22px]" strokeWidth={isActive ? 2.5 : 2} />
              <span className={clsx(
                'text-[10px] font-body font-medium tracking-wide',
                isActive && 'font-semibold'
              )}>
                {tab.label}
              </span>
              {isActive && (
                <span className="absolute bottom-1.5 w-1 h-1 rounded-full bg-accent-600" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export { BottomTabBar };

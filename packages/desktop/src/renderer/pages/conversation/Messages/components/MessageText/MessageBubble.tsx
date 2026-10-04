/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import classNames from 'classnames';

/** Shared original message bubble, also used for native Pi message content. */
export function MessageBubble({
  user,
  cron = false,
  teammate = false,
  teammateColor,
  children,
}: React.PropsWithChildren<{
  user: boolean;
  cron?: boolean;
  teammate?: boolean;
  teammateColor?: string;
}>) {
  return (
    <div
      className={classNames('min-w-0 [&>p:first-child]:mt-0px [&>p:last-child]:mb-0px', {
        'bg-aou-2 p-6px md:p-8px': user || cron,
        'bg-3 p-6px md:p-8px': teammate,
        'w-full': !(user || cron || teammate),
      })}
      style={
        user || cron
          ? { borderRadius: '8px 0 8px 8px', color: 'var(--text-primary)' }
          : teammate
            ? { borderRadius: '0 8px 8px 8px', ...(teammateColor ? { borderLeft: `3px solid ${teammateColor}` } : {}) }
            : undefined
      }
    >
      {children}
    </div>
  );
}

export function MessageActionRow({ user, children }: React.PropsWithChildren<{ user: boolean }>) {
  return (
    <div className={classNames('h-32px flex items-center mt-4px gap-8px', { 'flex-row-reverse': user })}>
      {children}
    </div>
  );
}

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import classNames from 'classnames';
import './titlebar.css';

/** Original titlebar surface; each host supplies only its supported actions. */
export default function TitlebarFrame({
  containerRef,
  menuRef,
  toolbarRef,
  style,
  menuStyle,
  isMobile = false,
  isDesktop = true,
  isMac = false,
  mobileConversation = false,
  centered = true,
  title,
  menu,
  brand,
  toolbar,
}: {
  containerRef?: React.Ref<HTMLDivElement>;
  menuRef?: React.Ref<HTMLDivElement>;
  toolbarRef?: React.Ref<HTMLDivElement>;
  style?: React.CSSProperties;
  menuStyle?: React.CSSProperties;
  isMobile?: boolean;
  isDesktop?: boolean;
  isMac?: boolean;
  mobileConversation?: boolean;
  centered?: boolean;
  title: string;
  menu: React.ReactNode;
  brand?: React.ReactNode;
  toolbar?: React.ReactNode;
}) {
  return (
    <div
      ref={containerRef}
      style={style}
      className={classNames('flex items-center gap-8px app-titlebar bg-2 border-b border-[var(--border-base)]', {
        'app-titlebar--mobile': isMobile,
        'app-titlebar--mobile-conversation': mobileConversation,
        'app-titlebar--desktop': isDesktop,
        'app-titlebar--mac': isMac,
      })}
    >
      <div ref={menuRef} className='app-titlebar__menu' style={menuStyle}>
        {menu}
      </div>
      <div
        className={classNames('app-titlebar__brand', { 'app-titlebar__brand--centered': centered })}
        aria-label={title}
        title={title}
      >
        {brand}
      </div>
      <div ref={toolbarRef} className='app-titlebar__toolbar'>
        {toolbar}
      </div>
    </div>
  );
}

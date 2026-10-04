/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { Layout } from '@arco-design/web-react';
import FlexFullContainer from '@/renderer/components/layout/FlexFullContainer';
import './chat-layout.css';

export function ChatHeader({ title, extra }: { title: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <Layout.Header className='min-h-44px flex items-center justify-between px-16px pt-8px pb-10px gap-16px !bg-1 chat-layout-header chat-layout-header--glass overflow-hidden'>
      <FlexFullContainer className='h-full min-w-0' containerClassName='flex items-center'>
        {title}
      </FlexFullContainer>
      <div className='flex items-center gap-12px shrink-0'>{extra}</div>
    </Layout.Header>
  );
}

export function ChatContent({ children }: React.PropsWithChildren) {
  return <Layout.Content className='flex flex-col flex-1 bg-1 overflow-hidden'>{children}</Layout.Content>;
}

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { Layout } from '@arco-design/web-react';
import classNames from 'classnames';
import '@renderer/styles/layout.css';

/** AionUI's shared window layout, independent of the conversation transport. */
export default function LayoutFrame({
  titlebar,
  brand,
  sider,
  siderDragHandle,
  adjacent,
  overlays,
  children,
  isMobile,
  collapsed,
  siderWidth,
  siderStyle,
  onCollapse,
  mainRowRef,
  contentHidden,
}: React.PropsWithChildren<{
  titlebar: React.ReactNode;
  brand: React.ReactNode;
  sider: React.ReactNode;
  siderDragHandle?: React.ReactNode;
  adjacent?: React.ReactNode;
  overlays?: React.ReactNode;
  isMobile: boolean;
  collapsed: boolean;
  siderWidth: number;
  siderStyle?: React.CSSProperties;
  onCollapse: () => void;
  mainRowRef?: React.Ref<HTMLDivElement>;
  contentHidden?: boolean;
}>) {
  return (
    <div className='app-shell flex flex-col size-full min-h-0'>
      {titlebar}
      {isMobile && !collapsed && (
        <div className='fixed inset-0 bg-black/30 z-90' onClick={onCollapse} aria-hidden='true' />
      )}
      <Layout className='size-full layout flex-1 min-h-0'>
        <Layout.Sider
          collapsedWidth={0}
          collapsed={collapsed}
          width={siderWidth}
          className={classNames('!bg-2 layout-sider', { collapsed })}
          style={siderStyle}
        >
          <Layout.Header
            className={classNames(
              'flex items-center justify-start pt-8px pb-8px ps-18px pe-16px gap-12px layout-sider-header',
              isMobile && 'layout-sider-header--mobile',
              { 'cursor-pointer group': collapsed }
            )}
          >
            {brand}
          </Layout.Header>
          <Layout.Content className='pt-0 px-8px pb-0 layout-sider-content'>{sider}</Layout.Content>
          {siderDragHandle}
        </Layout.Sider>
        <div ref={mainRowRef} className='flex flex-1 min-h-0 overflow-hidden'>
          <Layout.Content
            className='bg-1 layout-content flex flex-col min-h-0 flex-1'
            onClick={() => {
              if (isMobile && !collapsed) onCollapse();
            }}
            style={isMobile ? { width: '100%' } : contentHidden ? { display: 'none' } : undefined}
          >
            {children}
          </Layout.Content>
          {adjacent}
        </div>
        {overlays}
      </Layout>
    </div>
  );
}

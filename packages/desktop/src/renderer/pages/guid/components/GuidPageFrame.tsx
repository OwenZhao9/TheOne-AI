/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from '../index.module.css';

/** Welcome layout shared by the AionCore and direct Pi entry points. */
export default function GuidPageFrame({
  containerRef,
  children,
  footer,
  welcome = true,
}: React.PropsWithChildren<{
  containerRef?: React.Ref<HTMLDivElement>;
  footer?: React.ReactNode;
  /** Keep the composer mounted when the first message turns the welcome view into a conversation. */
  welcome?: boolean;
}>) {
  const { t } = useTranslation();
  return (
    <div ref={containerRef} className={welcome ? styles.guidContainer : 'shrink-0 pb-8px pt-10px'}>
      <div className={welcome ? styles.guidLayout : 'chat-surface-fluid'}>
        {welcome && (
          <div className={styles.heroHeader}>
            <p className='text-2xl font-semibold mb-0 text-t-primary text-center'>{t('conversation.welcome.title')}</p>
          </div>
        )}
        {children}
      </div>
      {footer}
    </div>
  );
}

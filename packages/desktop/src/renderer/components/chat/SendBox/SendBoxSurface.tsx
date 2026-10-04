/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import './sendbox.css';

/** Original conversation composer surface with transport-independent content. */
export function SendBoxPanel({
  panelRef,
  isOverlayOpen,
  isFileDragging,
  isInputActive,
  activeBorderColor,
  inactiveBorderColor,
  activeShadow,
  dragHandlers,
  children,
}: React.PropsWithChildren<{
  panelRef?: React.Ref<HTMLDivElement>;
  isOverlayOpen: boolean;
  isFileDragging: boolean;
  isInputActive: boolean;
  activeBorderColor: string;
  inactiveBorderColor: string;
  activeShadow: string;
  dragHandlers: React.HTMLAttributes<HTMLDivElement>;
}>) {
  return (
    <div
      ref={panelRef}
      className={`sendbox-panel relative p-16px border-3 b bg-dialog-fill-0 b-solid rd-20px flex flex-col ${isOverlayOpen ? 'overflow-visible' : 'overflow-hidden'} ${isFileDragging ? 'b-dashed sendbox-panel--dragging' : ''}`}
      style={{
        transition: 'box-shadow 0.25s ease, border-color 0.25s ease',
        ...(isFileDragging
          ? {
              backgroundColor: 'var(--color-primary-light-1)',
              borderColor: 'rgb(var(--primary-3))',
              borderWidth: '1px',
            }
          : {
              borderWidth: '1px',
              borderColor: isInputActive ? activeBorderColor : inactiveBorderColor,
              boxShadow: isInputActive ? activeShadow : 'none',
            }),
      }}
      {...dragHandlers}
    >
      {children}
    </div>
  );
}

export function SendBoxActionRow({ tools, actions }: { tools: React.ReactNode; actions: React.ReactNode }) {
  return (
    <div className='flex items-center justify-between gap-2 w-full'>
      {tools}
      <div className='sendbox-actions flex items-center gap-1'>{actions}</div>
    </div>
  );
}

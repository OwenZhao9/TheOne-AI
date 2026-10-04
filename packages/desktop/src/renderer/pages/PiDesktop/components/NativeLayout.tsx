import React, { useState } from 'react';
import { Button } from '@arco-design/web-react';
import { Search, ExpandLeft, ExpandRight } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import LayoutFrame from '@/renderer/components/layout/Layout/LayoutFrame';
import TitlebarFrame from '@/renderer/components/layout/Titlebar/TitlebarFrame';
import { LayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { useResizableSplit } from '@/renderer/hooks/ui/useResizableSplit';
import theOneLogo from '@/renderer/assets/logos/brand/theone.png';
import { isMacOS } from '@/renderer/utils/platform';

/** Supply native Pi actions to AionUI's original application layout. */
export default function NativeLayout({
  sider,
  adjacent,
  children,
  search,
}: React.PropsWithChildren<{
  sider: React.ReactNode;
  adjacent?: React.ReactNode;
  search: () => void;
}>) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(localStorage.getItem('pi.siderCollapsed') === 'true');
  const collapse = (value: boolean): void => {
    setCollapsed(value);
    localStorage.setItem('pi.siderCollapsed', String(value));
  };
  const { splitRatio, createDragHandle } = useResizableSplit({
    unit: 'px',
    defaultWidth: 260,
    minWidth: 200,
    maxWidth: 400,
    storageKey: 'pi.siderWidth',
    collapseThreshold: 140,
    collapsedWidth: 0,
    collapsed,
    onCollapsedChange: collapse,
  });
  return (
    <LayoutContext.Provider value={{ isMobile: false, siderCollapsed: collapsed, setSiderCollapsed: collapse }}>
      <LayoutFrame
        isMobile={false}
        collapsed={collapsed}
        siderWidth={splitRatio}
        siderStyle={{ position: 'relative', overflow: 'visible' }}
        onCollapse={() => collapse(true)}
        titlebar={
          <TitlebarFrame
            title='TheOne'
            isMac={isMacOS()}
            menuStyle={isMacOS() ? { marginLeft: 76 } : undefined}
            menu={
              <>
                <Button
                  type='text'
                  className='app-titlebar__button'
                  aria-label={t(collapsed ? 'common.expandMore' : 'common.collapse')}
                  title={t(collapsed ? 'common.expandMore' : 'common.collapse')}
                  icon={collapsed ? <ExpandRight size={18} /> : <ExpandLeft size={18} />}
                  onClick={() => collapse(!collapsed)}
                />
                <Button
                  type='text'
                  className='app-titlebar__button'
                  aria-label={t('common.pi.search')}
                  title={t('common.pi.search')}
                  icon={<Search size={18} />}
                  onClick={search}
                />
              </>
            }
          />
        }
        brand={
          <>
            <img src={theOneLogo} alt='' className='size-32px shrink-0 object-contain' draggable={false} />
            <div className='text-16px text-t-primary collapsed-hidden font-semibold'>TheOne</div>
          </>
        }
        sider={sider}
        siderDragHandle={createDragHandle({
          className: 'z-20',
          style: { right: '-4px', width: '8px' },
          linePlacement: 'start',
        })}
        adjacent={adjacent}
      >
        {children}
      </LayoutFrame>
    </LayoutContext.Provider>
  );
}

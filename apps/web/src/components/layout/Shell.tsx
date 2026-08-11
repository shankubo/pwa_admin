import { useState } from "react";
import { Outlet } from "react-router-dom";
import { AppDrawer } from "./AppDrawer";
import { TopBar } from "./TopBar";
import { PullToRefresh } from "./PullToRefresh";
import { UpdateBanner } from "./UpdateBanner";

export function Shell() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-background">
      <UpdateBanner />
      <TopBar onMenuClick={() => setDrawerOpen(true)} />
      <AppDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
      <PullToRefresh>
        <main className="mx-auto max-w-lg p-4 pb-24">
          <Outlet />
        </main>
      </PullToRefresh>
    </div>
  );
}

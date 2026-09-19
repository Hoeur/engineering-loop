'use client';

import type * as React from 'react';
import { Monitor } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@engloop/ui';
import { VIEWPORT_PRESETS } from '@engloop/types';
import { FindingsScreen } from '@/components/common/findings-screen';

export default function UiQaPage(): React.JSX.Element {
  return (
    <>
      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Viewport presets</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {Object.entries(VIEWPORT_PRESETS).map(([name, preset]) => (
              <span key={name} className="rounded-md border border-border px-2 py-1 font-mono">
                {name.toLowerCase()} {preset.width}×{preset.height}
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            The UI QA pipeline (Playwright capture → screenshots → console and network errors → AI
            review) is modelled end to end. Screenshot capture is mocked in this MVP; the Screenshot
            model, viewport presets and UI finding categories are real.
          </p>
        </CardContent>
      </Card>

      <FindingsScreen
        title="UI QA"
        description="Layout, responsive, accessibility and console findings from UI review."
        icon={Monitor}
        categories={['UI', 'ACCESSIBILITY']}
        emptyTitle="No open UI findings"
        emptyDescription="Run a UI review on a task to capture screenshots and collect findings."
      />
    </>
  );
}

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="top">
      <a routerLink="/" class="brand">Questions de l'agent</a>
    </header>
    <router-outlet />
  `,
})
export class App {}

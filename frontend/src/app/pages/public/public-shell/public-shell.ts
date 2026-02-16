import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Footer } from '../../../shared/footer/footer';
import { Topbar } from '../../../shared/topbar/topbar';

@Component({
  selector: 'app-public-shell',
  imports: [RouterOutlet, Topbar, Footer],
  templateUrl: './public-shell.html',
})
export class PublicShell {
}

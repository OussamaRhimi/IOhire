import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Chatbot } from '../../../shared/chatbot/chatbot';
import { Footer } from '../../../shared/footer/footer';
import { Topbar } from '../../../shared/topbar/topbar';

@Component({
  selector: 'app-public-shell',
  imports: [RouterOutlet, Topbar, Footer, Chatbot],
  templateUrl: './public-shell.html',
})
export class PublicShell {
}

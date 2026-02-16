import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AdminSidebar } from '../../../shared/admin-sidebar/admin-sidebar';

@Component({
  selector: 'app-admin-shell',
  imports: [RouterOutlet, AdminSidebar],
  templateUrl: './admin-shell.html',
})
export class AdminShell {}

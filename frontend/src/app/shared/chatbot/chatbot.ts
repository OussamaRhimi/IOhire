import {
  Component,
  ElementRef,
  inject,
  signal,
  ViewChild,
  AfterViewChecked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, type LucideIconData } from 'lucide-angular';
import { MessageCircle, Send, X, Bot, User } from 'lucide-angular/src/icons';
import { StrapiApi } from '../../core/strapi/strapi.api';
import { toErrorMessage } from '../../core/http/http-error';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
};

@Component({
  selector: 'app-chatbot',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  templateUrl: './chatbot.html',
  styleUrl: './chatbot.css',
})
export class Chatbot implements AfterViewChecked {
  private readonly api = inject(StrapiApi);

  readonly open = signal(false);
  readonly sending = signal(false);
  readonly input = signal('');
  readonly messages = signal<ChatMessage[]>([]);
  readonly error = signal<string | null>(null);

  readonly iconChat: LucideIconData = MessageCircle;
  readonly iconSend: LucideIconData = Send;
  readonly iconClose: LucideIconData = X;
  readonly iconBot: LucideIconData = Bot;
  readonly iconUser: LucideIconData = User;

  @ViewChild('messagesContainer') messagesContainer?: ElementRef<HTMLDivElement>;
  private shouldScroll = false;

  toggle() {
    this.open.update((v) => !v);
    if (this.open() && this.messages().length === 0) {
      this.messages.set([
        {
          role: 'assistant',
          content:
            'Hi! 👋 I\'m here to help you with anything related to the candidate portal. You can ask me about:\n\n' +
            '• How to apply for a job\n' +
            '• Tracking your application status\n' +
            '• Understanding your CV score\n' +
            '• Getting job recommendations\n' +
            '• Data privacy & your rights\n\n' +
            'How can I help you?',
          timestamp: new Date(),
        },
      ]);
    }
  }

  ngAfterViewChecked() {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  async send() {
    const text = this.input().trim();
    if (!text || this.sending()) return;

    this.error.set(null);
    this.input.set('');

    const userMsg: ChatMessage = { role: 'user', content: text, timestamp: new Date() };
    this.messages.update((msgs) => [...msgs, userMsg]);
    this.shouldScroll = true;

    try {
      this.sending.set(true);

      // Build conversation history for context (last 10 messages)
      const history = this.messages()
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }));

      const reply = await this.api.publicChat(history);
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: reply,
        timestamp: new Date(),
      };
      this.messages.update((msgs) => [...msgs, assistantMsg]);
      this.shouldScroll = true;
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.sending.set(false);
    }
  }

  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  private scrollToBottom() {
    const el = this.messagesContainer?.nativeElement;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }
}

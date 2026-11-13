/**
 * Voice commands, when the headset browser has no speech recognition of its
 * own: a short spoken clip (a few seconds of WebM/Opus, recorded only while
 * Voice commands is on and someone is speaking) is sent to Google Cloud
 * Speech-to-Text with the command phrases as hints, and only the text comes
 * back. Nothing is stored or logged.
 *
 * Off unless VOICE_STT=google. STT_API and STT_TOKEN_URL point it at a local
 * test double ('' token URL sends no credentials).
 */
import { COMMAND_PHRASES } from '../src/voice-commands.ts';

export const MAX_CLIP_BYTES = 96 * 1024;

export class SpeechToText {
  private token = '';
  private tokenExpires = 0;

  private api: string;
  private tokenUrl: string;

  constructor(
    api = 'https://speech.googleapis.com',
    tokenUrl = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
  ) {
    this.api = api;
    this.tokenUrl = tokenUrl;
  }

  private async auth(): Promise<Record<string, string>> {
    if (!this.tokenUrl) return {};
    if (Date.now() > this.tokenExpires - 60_000) {
      const res = await fetch(this.tokenUrl, { headers: { 'Metadata-Flavor': 'Google' } });
      if (!res.ok) throw new Error(`metadata token ${res.status}`);
      const body = (await res.json()) as { access_token: string; expires_in: number };
      this.token = body.access_token;
      this.tokenExpires = Date.now() + body.expires_in * 1000;
    }
    return { Authorization: `Bearer ${this.token}` };
  }

  /** The best transcript of one WebM/Opus clip ('' when nothing was understood). */
  async transcribe(clip: Buffer): Promise<string> {
    const res = await fetch(`${this.api}/v1/speech:recognize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await this.auth()) },
      body: JSON.stringify({
        config: {
          encoding: 'WEBM_OPUS',
          sampleRateHertz: 48000,
          languageCode: 'en-US',
          model: 'command_and_search',
          maxAlternatives: 1,
          profanityFilter: true,
          speechContexts: [{ phrases: COMMAND_PHRASES, boost: 15 }],
        },
        audio: { content: clip.toString('base64') },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`speech ${res.status}`);
    const body = (await res.json()) as { results?: { alternatives?: { transcript?: string }[] }[] };
    return (body.results ?? [])
      .map((r) => r.alternatives?.[0]?.transcript ?? '')
      .join(' ')
      .trim()
      .slice(0, 200);
  }
}

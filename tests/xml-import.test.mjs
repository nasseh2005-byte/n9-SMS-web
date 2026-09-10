import test from "node:test";
import assert from "node:assert/strict";
import { createXmlMessageParser, parseXmlMessages, mergeMessageArchives } from "../src/xmlImport.js";

const message = (guid, fields = "") => `<message guid="${guid}"><conversation>TEST</conversation><direction>incoming</direction>${fields}</message>`;
const archive = (body, count) => `<iphone_messages><messages${count === undefined ? "" : ` count="${count}"`}>${body}</messages></iphone_messages>`;

test("iPhone imports incoming/outgoing SMS and iMessage, preserving text, offset dates and metadata", () => {
  const xml = archive(message("one", '<date_ksa>2024-01-02T03:04:05+03:00</date_ksa><apple_date_raw>725760245123456789</apple_date_raw><text>  نص &amp; رابط\nhttps://example.test/?a=1&amp;b=2 😀  </text><service>SMS</service><is_read>true</is_read><is_delivered>true</is_delivered>')
    + message("two", '<direction>outgoing</direction><service>iMessage</service><text><![CDATA[<نص> & حرف]]></text><has_attachments>true</has_attachments><subject>موضوع</subject>'), 2);
  const [incoming, outgoing] = parseXmlMessages(xml);
  assert.equal(incoming.body, '  نص & رابط\nhttps://example.test/?a=1&b=2 😀  ');
  assert.equal(incoming.date, Date.UTC(2024, 0, 2, 0, 4, 5));
  assert.equal(incoming.rawDate, '2024-01-02T03:04:05+03:00');
  assert.equal(incoming.rawAppleDate, '725760245123456789');
  assert.equal(incoming.dateSent, null);
  assert.equal(incoming.type, '1');
  assert.equal(incoming.read, '1');
  assert.equal(incoming.isDelivered, true);
  assert.equal(outgoing.type, '2');
  assert.equal(outgoing.service, 'iMessage');
  assert.equal(outgoing.body, '<نص> & حرف');
  assert.equal(outgoing.subject, 'موضوع');
  assert.equal(outgoing.hasAttachments, true);
  assert.equal(outgoing.date, null);
});

test("iPhone keeps empty messages and falls back to party or conversation and normalizes EJADA", () => {
  const messages = parseXmlMessages(archive('<message><party>Person</party><direction>incoming</direction><text/></message>'
    + '<message><conversation>Group</conversation><party/><direction>outgoing</direction></message>'
    + '<message><conversation>ejadh</conversation><direction>incoming</direction></message>'));
  assert.equal(messages.length, 3);
  assert.equal(messages[0].address, 'Person');
  assert.equal(messages[0].body, '');
  assert.equal(messages[1].address, 'Group');
  assert.equal(messages[2].address, 'EJADA');
});

test("Apple nanosecond fallback uses integer arithmetic and never invents a missing time", () => {
  const messages = parseXmlMessages(archive(message('a', '<apple_date_raw>414704387123456789</apple_date_raw>')
    + message('b', '<date_ksa>invalid</date_ksa><apple_date_raw>0</apple_date_raw>')
    + message('c', '<date_ksa>2024-01-02T03:04:05</date_ksa>')));
  assert.equal(messages[0].date, 1393011587123);
  assert.equal(messages[1].date, null);
  assert.equal(messages[2].date, null);
});

test("legacy SMS preserves original timestamps, attributes, entities and missing values", () => {
  const [sms, missing] = parseXmlMessages('<smses count="2"><sms address="AMANA 940" date="1700000000123" date_sent="1699999999999" type="2" read="0" status="-1" body="أول&#10;ثان &amp; &quot;نص&quot;"/><sms/></smses>');
  assert.equal(sms.address, 'EJADA');
  assert.equal(sms.date, 1700000000123);
  assert.equal(sms.dateSent, 1699999999999);
  assert.equal(sms.body, 'أول\nثان & "نص"');
  assert.equal(sms.type, '2');
  assert.equal(sms.status, '-1');
  assert.equal(missing.date, null);
});

test("streaming chunks preserve text and CDATA across arbitrary boundaries", () => {
  const xml = archive(message('one', '<text>نص &amp; 😀<![CDATA[\nآخر]]></text>'));
  const parser = createXmlMessageParser();
  for (let i = 0; i < xml.length; i += 3) parser.write(xml.slice(i, i + 3));
  assert.deepEqual(parser.finish(), parseXmlMessages(xml));
});

test("invalid, unsupported, truncated and count-mismatched XML fail without partial imports", () => {
  assert.throws(() => parseXmlMessages('<smses><sms/></bad>'), /غير صالح/);
  assert.throws(() => parseXmlMessages('<smses><sms/>'), /غير صالح/);
  assert.throws(() => parseXmlMessages('<smses><sms body="&undefined;"/></smses>'), /غير صالح/);
  assert.throws(() => parseXmlMessages('<document><message>hello</message></document>'), /مدعومة/);
  assert.throws(() => parseXmlMessages(archive(message('one'), 2)), /عدد/);
  assert.throws(() => parseXmlMessages(archive('<message><direction>unknown</direction></message>')), /اتجاه/);
});

test("merging split iPhone archives is idempotent and retains distinct GUIDs and manual messages", () => {
  const manual = { id: 'manual-1', sourceKind: 'manual', address: 'TEST', body: 'hello', date: 1, type: '1' };
  const first = parseXmlMessages(archive(message('one', '<text>same</text>')));
  const second = parseXmlMessages(archive(message('two', '<text>same</text>')));
  const merged = mergeMessageArchives(mergeMessageArchives([manual], first), second);
  assert.equal(merged.length, 3);
  assert.ok(merged.includes(manual));
  assert.deepEqual(mergeMessageArchives(merged, parseXmlMessages(archive(message('one', '<text>same</text>')))), merged);
  const legacy = '<smses><sms address="TEST" date="1" body="hello"/></smses>';
  assert.equal(mergeMessageArchives([manual], parseXmlMessages(legacy)).length, 1);
});

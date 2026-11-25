import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { isValidDateString, validateFormSchema, validateFormSubmission } from './form-schema';

const schema = {
  fields: [
    { name: 'amount', label: 'مبلغ', type: 'number', required: true },
    { name: 'department', label: 'واحد', type: 'select', options: ['FIN', 'HR'] },
    { name: 'justification', label: 'توجیه درخواست', type: 'textarea' },
    { name: 'approved', label: 'تأیید', type: 'checkbox' },
  ],
  rules: [
    { when: { field: 'amount', operator: 'gt', value: 1000 }, then: { required: ['justification'], visible: ['justification'] } },
    { when: { field: 'department', operator: 'eq', value: 'HR' }, then: { hidden: ['approved'] } },
  ],
};

test('validates a versioned form schema with conditional rules', () => {
  assert.equal(validateFormSchema(schema).length, 4);
});

test('requires base required fields', () => {
  assert.throws(() => validateFormSubmission(schema, { department: 'FIN' }), BadRequestException);
});

test('enforces conditional required fields when a rule matches', () => {
  assert.throws(() => validateFormSubmission(schema, { amount: 1500, department: 'FIN' }), BadRequestException);
  assert.doesNotThrow(() => validateFormSubmission(schema, { amount: 1500, department: 'FIN', justification: 'Budget approval' }));
});

test('conditionally visible fields are not required while their rule is inactive', () => {
  assert.doesNotThrow(() => validateFormSubmission(schema, { amount: 10, department: 'FIN' }));
  assert.throws(() => validateFormSubmission(schema, { amount: 1500, department: 'FIN' }), BadRequestException);
});

test('accepts a valid select option and boolean checkbox', () => {
  assert.doesNotThrow(() => validateFormSubmission(schema, {
    amount: 10, department: 'HR', approved: false,
  }));
});

test('rejects unknown fields and invalid value types', () => {
  assert.throws(() => validateFormSubmission(schema, { amount: 10, extra: 'unexpected' }), BadRequestException);
  assert.throws(() => validateFormSubmission(schema, { amount: '10' }), BadRequestException);
  assert.throws(() => validateFormSubmission(schema, { amount: 10, department: 'SALES' }), BadRequestException);
});

test('rejects duplicate names, unsafe field names and unknown conditional targets', () => {
  assert.throws(() => validateFormSchema({ fields: [
    { name: 'x', label: 'X', type: 'text' }, { name: 'x', label: 'Duplicate', type: 'text' },
  ] }), BadRequestException);
  assert.throws(() => validateFormSchema({ fields: [{ name: '__proto__', label: 'Unsafe', type: 'text' }] }), BadRequestException);
  assert.throws(() => validateFormSchema({ fields: [{ name: 'amount', label: 'Amount', type: 'number' }],
    rules: [{ when: { field: 'amount', operator: 'gt', value: 1 }, then: { required: ['missing'] } }] }), BadRequestException);
});

const rich = {
  fields: [
    { name: 'title', label: 'عنوان', type: 'text', required: true, minLength: 3, maxLength: 10 },
    { name: 'score', label: 'امتیاز', type: 'number', min: 0, max: 100 },
    { name: 'contact', label: 'ایمیل', type: 'email' },
    { name: 'due', label: 'موعد', type: 'date' },
    { name: 'tags', label: 'برچسب‌ها', type: 'multiselect', options: ['a', 'b', 'c'] },
  ],
};

test('enforces text length limits and number ranges', () => {
  assert.doesNotThrow(() => validateFormSubmission(rich, { title: 'سلام دنیا', score: 100 }));
  assert.throws(() => validateFormSubmission(rich, { title: 'ab' }), BadRequestException);
  assert.throws(() => validateFormSubmission(rich, { title: 'x'.repeat(11) }), BadRequestException);
  assert.throws(() => validateFormSubmission(rich, { title: 'abcd', score: 101 }), BadRequestException);
  assert.throws(() => validateFormSubmission(rich, { title: 'abcd', score: -1 }), BadRequestException);
});

test('applies default size caps when the designer sets no maxLength', () => {
  const plain = { fields: [{ name: 'note', label: 'یادداشت', type: 'textarea' }] };
  assert.doesNotThrow(() => validateFormSubmission(plain, { note: 'x'.repeat(20000) }));
  assert.throws(() => validateFormSubmission(plain, { note: 'x'.repeat(20001) }), BadRequestException);
});

test('validates email and multiselect values', () => {
  assert.doesNotThrow(() => validateFormSubmission(rich, { title: 'abcd', contact: 'a@b.co', tags: ['a', 'c'] }));
  assert.throws(() => validateFormSubmission(rich, { title: 'abcd', contact: 'not-an-email' }), BadRequestException);
  assert.throws(() => validateFormSubmission(rich, { title: 'abcd', tags: ['a', 'a'] }), BadRequestException);
  assert.throws(() => validateFormSubmission(rich, { title: 'abcd', tags: ['z'] }), BadRequestException);
  assert.throws(() => validateFormSubmission(rich, { title: 'abcd', tags: 'a' }), BadRequestException);
});

test('validates dates: real Gregorian days and plausible Jalali days, Persian digits included', () => {
  assert.equal(isValidDateString('2026-11-25'), true);
  assert.equal(isValidDateString('2026-02-30'), false);
  assert.equal(isValidDateString('2026/11/25'), false);
  assert.equal(isValidDateString('1405/09/04'), true);
  assert.equal(isValidDateString('۱۴۰۵/۰۹/۰۴'), true);
  assert.equal(isValidDateString('1405/07/31'), false);
  assert.equal(isValidDateString('1405/13/01'), false);
  assert.equal(isValidDateString('hello'), false);
  assert.throws(() => validateFormSubmission(rich, { title: 'abcd', due: 'tomorrow' }), BadRequestException);
});

test('rejects malformed constraints and wrong-type constraints in the schema', () => {
  assert.throws(() => validateFormSchema({ fields: [{ name: 'a', label: 'A', type: 'text', minLength: 5, maxLength: 2 }] }), BadRequestException);
  assert.throws(() => validateFormSchema({ fields: [{ name: 'a', label: 'A', type: 'number', min: 5, max: 2 }] }), BadRequestException);
  assert.throws(() => validateFormSchema({ fields: [{ name: 'a', label: 'A', type: 'checkbox', maxLength: 5 }] }), BadRequestException);
  assert.throws(() => validateFormSchema({ fields: [{ name: 'a', label: 'A', type: 'select', options: ['x', 'x'] }] }), BadRequestException);
  assert.throws(() => validateFormSchema({ fields: [{ name: 'a', label: 'A', type: 'text', maxLength: 999999 }] }), BadRequestException);
});

test('legacy schemas without constraints keep validating', () => {
  assert.equal(validateFormSchema({ fields: [{ name: 'a', label: 'A', type: 'text' }, { name: 'b', label: 'B', type: 'select', options: ['1'] }] }).length, 2);
});

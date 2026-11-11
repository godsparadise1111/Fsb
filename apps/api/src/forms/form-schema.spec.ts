import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { validateFormSchema, validateFormSubmission } from './form-schema';

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

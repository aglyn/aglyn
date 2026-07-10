/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Ported from `@data-driven-forms/mui-component-mapper` (Apache-2.0) and
 * updated for the current MUI APIs.
 */

import { Fragment, useContext } from 'react'

import {
  Button,
  Grid,
  type GridProps,
  Step,
  StepLabel,
  type StepLabelProps,
  type StepProps,
  Stepper,
  type StepperProps,
} from '@mui/material'
import { styled } from '@mui/material/styles'

import clsx from 'clsx'

import CommonWizard from '@data-driven-forms/common/wizard'
import selectNext from '@data-driven-forms/common/wizard/select-next'

import {
  type FormOptions,
  FormSpy,
  WizardContext,
} from '../vendor/data-driven-forms'


/* -------------------------------- wizard nav ------------------------------ */

const NAV_PREFIX = 'WizardNav'

const navClasses = {
  stepper: `${NAV_PREFIX}-stepper`,
}

const StyledStepper = styled(Stepper)(() => ({
  [`&.${navClasses.stepper}`]: {
    width: '100%',
  },
}))

interface StepInfo {
  title?: string
  label?: string
  StepLabelProps?: StepLabelProps
  StepProps?: StepProps
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

interface WizardNavProps {
  StepperProps?: StepperProps
  stepsInfo: StepInfo[]
  activeStepIndex: number
}

const WizardNav = ({
  StepperProps = {},
  stepsInfo,
  activeStepIndex,
}: WizardNavProps) => (
  <StyledStepper
    {...StepperProps}
    className={clsx(navClasses.stepper, StepperProps.className)}
    activeStep={activeStepIndex}
  >
    {stepsInfo.map(({ title, label, StepLabelProps = {}, StepProps = {} }, idx) => (
      <Step {...StepProps} key={idx}>
        <StepLabel {...StepLabelProps}>{title || label}</StepLabel>
      </Step>
    ))}
  </StyledStepper>
)

/* ----------------------------- wizard buttons ----------------------------- */

const BUTTONS_PREFIX = 'WizardStepButtons'

const buttonClasses = {
  buttons: `${BUTTONS_PREFIX}-buttons`,
  button: `${BUTTONS_PREFIX}-button`,
  buttonsContainer: `${BUTTONS_PREFIX}-buttonsContainer`,
}

const StyledButtonsGrid = styled(Grid)(() => ({
  [`& .${buttonClasses.buttons}`]: {
    display: 'flex',
    justifyContent: 'flex-end',
  },

  [`& .${buttonClasses.button}`]: {
    marginRight: 16,
  },

  [`&.${buttonClasses.buttonsContainer}`]: {
    marginTop: 36,
  },
}))

interface NextButtonProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nextStep?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleNext: (nextStep?: any) => void
  nextLabel: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getState: () => any
  handleSubmit: () => void
  submitLabel: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conditionalSubmitFlag?: any
}

const NextButton = ({
  nextStep,
  handleNext,
  nextLabel,
  getState,
  handleSubmit,
  submitLabel,
  conditionalSubmitFlag,
}: NextButtonProps) => {
  const nextResult = nextStep ? selectNext(nextStep, getState) : nextStep
  const progressNext = nextResult !== conditionalSubmitFlag && nextStep
  const { valid, validating, submitting } = getState()

  return (
    <Button
      variant="contained"
      color="primary"
      disabled={!valid || validating || submitting}
      onClick={() => (progressNext ? handleNext(nextResult) : handleSubmit())}
    >
      {progressNext ? nextLabel : submitLabel}
    </Button>
  )
}

interface ButtonLabels {
  cancel: string
  submit: string
  back: string
  next: string
}

interface WizardStepButtonsProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buttons?: React.ComponentType<any>
  disableBack: boolean
  handlePrev: () => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nextStep?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleNext: (nextStep?: any) => void
  buttonLabels: ButtonLabels
  formOptions: FormOptions
  ButtonContainerProps?: GridProps
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conditionalSubmitFlag?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

const WizardStepButtons = ({
  buttons: Buttons,
  ...props
}: WizardStepButtonsProps) => {
  if (Buttons) {
    return <Buttons classes={buttonClasses} {...props} />
  }

  const {
    disableBack,
    handlePrev,
    nextStep,
    handleNext,
    buttonLabels: { cancel, submit, back, next },
    formOptions,
    ButtonContainerProps = {},
    conditionalSubmitFlag,
  } = props

  return (
    <StyledButtonsGrid
      container
      direction="row"
      sx={{ justifyContent: 'space-evenly' }}
      {...ButtonContainerProps}
      className={clsx(
        buttonClasses.buttonsContainer,
        ButtonContainerProps.className,
      )}
    >
      <FormSpy
        subscription={{
          values: true,
          valid: true,
          validating: true,
          submitting: true,
        }}
      >
        {() => (
          <Fragment>
            <Grid size={{ md: 2, xs: 2 }}>
              <Button
                onClick={() =>
                  formOptions.onCancel?.(formOptions.getState().values)
                }
              >
                {cancel}
              </Button>
            </Grid>
            <Grid size={{ md: 10, xs: 10 }} className={buttonClasses.buttons}>
              <Button
                disabled={disableBack}
                onClick={() => handlePrev()}
                className={buttonClasses.button}
              >
                {back}
              </Button>
              <NextButton
                {...formOptions}
                conditionalSubmitFlag={conditionalSubmitFlag}
                handleNext={handleNext}
                nextStep={nextStep}
                nextLabel={next}
                submitLabel={submit}
              />
            </Grid>
          </Fragment>
        )}
      </FormSpy>
    </StyledButtonsGrid>
  )
}

/* --------------------------------- wizard --------------------------------- */

const PREFIX = 'MuiWizard'

const classes = {
  wizardBody: `${PREFIX}-wizardBody`,
}

const StyledWizard = styled(Grid)(() => ({
  [`& .${classes.wizardBody}`]: {
    padding: 24,
    margin: 0,
  },
}))

interface WizardButtonLabels {
  next?: string
  submit?: string
  cancel?: string
  back?: string
}

interface WizardInternalProps {
  buttonLabels?: WizardButtonLabels
  stepsInfo?: StepInfo[]
  ButtonContainerProps?: GridProps
  StepperProps?: StepperProps
  WizardBodyProps?: GridProps
  WizardProps?: GridProps
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conditionalSubmitFlag?: any
}

const WizardInternal = ({
  buttonLabels = {},
  stepsInfo,
  ButtonContainerProps,
  StepperProps,
  WizardBodyProps = {},
  WizardProps,
  conditionalSubmitFlag,
}: WizardInternalProps) => {
  const {
    formOptions,
    currentStep,
    handlePrev,
    onKeyDown,
    handleNext,
    activeStepIndex,
    prevSteps,
  } = useContext(WizardContext)

  const buttonLabelsFinal = {
    next: 'Continue',
    submit: 'Submit',
    cancel: 'Cancel',
    back: 'Back',
    ...buttonLabels,
  }

  return (
    <StyledWizard
      container
      {...WizardProps}
      onKeyDown={onKeyDown as React.KeyboardEventHandler<HTMLDivElement>}
    >
      {stepsInfo && (
        <WizardNav
          StepperProps={StepperProps}
          stepsInfo={stepsInfo}
          activeStepIndex={activeStepIndex}
        />
      )}
      <Grid
        container
        spacing={2}
        {...WizardBodyProps}
        className={clsx(classes.wizardBody, WizardBodyProps.className)}
      >
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {currentStep.fields.map((item: any) => formOptions.renderForm([item]))}
        <WizardStepButtons
          {...currentStep}
          formOptions={formOptions}
          buttonLabels={buttonLabelsFinal}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          handleNext={(nextStep: any) => handleNext(nextStep)}
          handlePrev={() => handlePrev()}
          disableBack={prevSteps.length === 0}
          conditionalSubmitFlag={conditionalSubmitFlag}
          ButtonContainerProps={ButtonContainerProps}
        />
      </Grid>
    </StyledWizard>
  )
}

export interface WizardProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

// The common Wizard's prop types are renderer-version specific; the schema
// always provides `fields` at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CommonWizardAny = CommonWizard as React.ComponentType<any>

export const Wizard = (props: WizardProps) => (
  <CommonWizardAny Wizard={WizardInternal} {...props} />
)

export default Wizard

import * as Notification from "../../Utils/Notifications.js";

import {
  BLOOD_GROUPS,
  DOMESTIC_HEALTHCARE_SUPPORT_CHOICES,
  GENDER_TYPES,
  MEDICAL_HISTORY_CHOICES,
  OCCUPATION_TYPES,
  RATION_CARD_CATEGORY,
  SOCIOECONOMIC_STATUS_CHOICES,
  VACCINES,
} from "../../Common/constants";
import {
  dateQueryString,
  getPincodeDetails,
  includesIgnoreCase,
  parsePhoneNumber,
  scrollTo,
  compareBy,
} from "../../Utils/utils";
import { navigate, useQueryParams } from "raviger";
import { statusType, useAbortableEffect } from "../../Common/utils";
import {
  lazy,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import AccordionV2 from "../Common/components/AccordionV2";
import ButtonV2 from "../Common/components/ButtonV2";
import CareIcon from "../../CAREUI/icons/CareIcon";
import CheckBoxFormField from "../Form/FormFields/CheckBoxFormField";
import CollapseV2 from "../Common/components/CollapseV2";
import ConfirmDialog from "../Common/ConfirmDialog";
import DateFormField from "../Form/FormFields/DateFormField";
import DialogModal from "../Common/Dialog";
import { DistrictModel, DupPatientModel, WardModel } from "../Facility/models";
import DuplicatePatientDialog from "../Facility/DuplicatePatientDialog";
import {
  FieldError,
  PhoneNumberValidator,
  RequiredFieldValidator,
} from "../Form/FieldValidators";
import { FieldErrorText, FieldLabel } from "../Form/FormFields/FormField";
import Form from "../Form/Form";
import { HCXPolicyModel } from "../HCX/models";
import HCXPolicyValidator from "../HCX/validators";
import InsuranceDetailsBuilder from "../HCX/InsuranceDetailsBuilder";
import LinkABHANumberModal from "../ABDM/LinkABHANumberModal";
import { PatientModel, Occupation, PatientMeta } from "./models";
import PhoneNumberFormField from "../Form/FormFields/PhoneNumberFormField";
import RadioFormField from "../Form/FormFields/RadioFormField";
import { SelectFormField } from "../Form/FormFields/SelectFormField";
import AutocompleteFormField from "../Form/FormFields/Autocomplete.js";
import Spinner from "../Common/Spinner";
import TextAreaFormField from "../Form/FormFields/TextAreaFormField";
import TextFormField from "../Form/FormFields/TextFormField";
import TransferPatientDialog from "../Facility/TransferPatientDialog";
import countryList from "../../Common/static/countries.json";
import { debounce } from "lodash-es";

import useAppHistory from "../../Common/hooks/useAppHistory";
import { validatePincode } from "../../Common/validation";
import { FormContextValue } from "../Form/FormContext.js";
import useAuthUser from "../../Common/hooks/useAuthUser.js";
import useQuery from "../../Utils/request/useQuery.js";
import routes from "../../Redux/api.js";
import request from "../../Utils/request/request.js";
import Error404 from "../ErrorPages/404";
import SelectMenuV2 from "../Form/SelectMenuV2.js";
import _ from "lodash";
import { ILocalBodies } from "../ExternalResult/models.js";
import { useTranslation } from "react-i18next";
import careConfig from "@careConfig";

const Loading = lazy(() => import("../Common/Loading"));
const PageTitle = lazy(() => import("../Common/PageTitle"));

type PatientForm = PatientModel &
  PatientMeta & { age?: number; is_postpartum?: boolean };

interface PatientRegisterProps extends PatientModel {
  facilityId: string;
}

interface medicalHistoryModel {
  id?: number;
  disease: string | number;
  details: string;
}

const medicalHistoryChoices = MEDICAL_HISTORY_CHOICES.reduce(
  (acc: Array<{ [x: string]: string }>, cur) => [
    ...acc,
    { [`medical_history_${cur.id}`]: "" },
  ],
  [],
);
const genderTypes = GENDER_TYPES;
const bloodGroups = [...BLOOD_GROUPS];
const occupationTypes = OCCUPATION_TYPES;
const vaccines = [...VACCINES];

const initForm: any = {
  name: "",
  age: "",
  year_of_birth: "",
  gender: "",
  phone_number: "+91",
  emergency_phone_number: "+91",
  blood_group: "",
  is_declared_positive: "false",
  date_declared_positive: new Date(),
  date_of_birth: null,
  medical_history: [],
  nationality: "India",
  passport_no: "",
  state: "",
  district: "",
  local_body: "",
  ward: "",
  address: "",
  permanent_address: "",
  sameAddress: true,
  village: "",
  allergies: "",
  pincode: "",
  present_health: "",
  date_of_return: null,
  is_antenatal: "false",
  date_of_test: null,
  treatment_plan: false,
  ongoing_medication: "",
  designation_of_health_care_worker: "",
  instituion_of_health_care_worker: "",
  covin_id: "",
  is_vaccinated: "false",
  number_of_doses: "0",
  vaccine_name: null,
  last_vaccinated_date: null,
  abha_number: null,
  ...medicalHistoryChoices,
  ration_card_category: null,
};

const initError = Object.assign(
  {},
  ...Object.keys(initForm).map((k) => ({ [k]: "" })),
);

const initialState = {
  form: { ...initForm },
  errors: { ...initError },
};

const patientFormReducer = (state = initialState, action: any) => {
  switch (action.type) {
    case "set_form": {
      return {
        ...state,
        form: action.form,
      };
    }
    case "set_error": {
      return {
        ...state,
        errors: action.errors,
      };
    }
    default:
      return state;
  }
};
export const parseOccupationFromExt = (occupation: Occupation) => {
  const occupationObject = OCCUPATION_TYPES.find(
    (item) => item.value === occupation,
  );
  return occupationObject?.id;
};

export const PatientRegister = (props: PatientRegisterProps) => {
  const submitController = useRef<AbortController>();
  const authUser = useAuthUser();
  const { t } = useTranslation();
  const { goBack } = useAppHistory();
  const { facilityId, id } = props;
  const [state, dispatch] = useReducer(patientFormReducer, initialState);
  const [showAlertMessage, setAlertMessage] = useState({
    show: false,
    message: "",
    title: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [showImport, setShowImport] = useState<{
    show?: boolean;
    field?: FormContextValue<PatientForm> | null;
  }>({
    show: false,
    field: null,
  });
  const [careExtId, setCareExtId] = useState("");
  const [formField, setFormField] = useState<any>();
  const [resetNum, setResetNum] = useState(false);
  const [isDistrictLoading, setIsDistrictLoading] = useState(false);
  const [isLocalbodyLoading, setIsLocalbodyLoading] = useState(false);
  const [isWardLoading, setIsWardLoading] = useState(false);
  const [districts, setDistricts] = useState<DistrictModel[]>([]);
  const [localBody, setLocalBody] = useState<ILocalBodies[]>([]);
  const [ward, setWard] = useState<WardModel[]>([]);
  const [ageInputType, setAgeInputType] = useState<
    "date_of_birth" | "age" | "alert_for_age"
  >("date_of_birth");
  const [statusDialog, setStatusDialog] = useState<{
    show?: boolean;
    transfer?: boolean;
    patientList: Array<DupPatientModel>;
  }>({ patientList: [] });
  const [patientName, setPatientName] = useState("");
  const [{ extId }, setQuery] = useQueryParams();
  const [showLinkAbhaNumberModal, setShowLinkAbhaNumberModal] = useState(false);
  const [showAutoFilledPincode, setShowAutoFilledPincode] = useState(false);
  const [insuranceDetails, setInsuranceDetails] = useState<HCXPolicyModel[]>(
    [],
  );
  const [isEmergencyNumberEnabled, setIsEmergencyNumberEnabled] =
    useState(false);
  const [insuranceDetailsError, setInsuranceDetailsError] =
    useState<FieldError>();

  useEffect(() => {
    if (extId && formField) {
      setCareExtId(extId);
      fetchExtResultData(formField);
    }
  }, [careExtId, formField]);

  const headerText = !id ? "Add Details of Patient" : "Update Patient Details";
  const buttonText = !id ? "Add Patient" : "Save Details";

  const fetchDistricts = useCallback(async (id: number) => {
    if (id > 0) {
      setIsDistrictLoading(true);
      const { res, data } = await request(routes.getDistrictByState, {
        pathParams: { id },
      });
      if (res?.ok && data) {
        setDistricts(data);
      }
      setIsDistrictLoading(false);
      return data ? [...data] : [];
    }
  }, []);

  const fetchLocalBody = useCallback(async (id: string) => {
    if (Number(id) > 0) {
      setIsLocalbodyLoading(true);
      const { data } = await request(routes.getLocalbodyByDistrict, {
        pathParams: { id },
      });
      setIsLocalbodyLoading(false);
      setLocalBody(data || []);
    } else {
      setLocalBody([]);
    }
  }, []);

  const fetchWards = useCallback(async (id: string) => {
    if (Number(id) > 0) {
      setIsWardLoading(true);
      const { data } = await request(routes.getWardByLocalBody, {
        pathParams: { id },
      });
      setIsWardLoading(false);
      if (data) {
        setWard(data.results);
      }
    } else {
      setWard([]);
    }
  }, []);

  const parseGenderFromExt = (gender: any, defaultValue: any) => {
    switch (gender.toLowerCase()) {
      case "m":
        return "1";
      case "f":
        return "2";
      case "o":
        return "3";
      default:
        return defaultValue;
    }
  };

  const fetchExtResultData = async (field: any) => {
    if (!careExtId) return;
    const { res, data } = await request(routes.externalResult, {
      pathParams: { id: careExtId },
    });

    if (res?.ok && data) {
      field.onChange({
        name: "name",
        value: data.name ? data.name : state.form.name,
      });
      field.onChange({
        name: "address",
        value: data.address ? data.address : state.form.address,
      });
      field.onChange({
        name: "permanent_address",
        value: data.permanent_address
          ? data.permanent_address
          : state.form.permanent_address,
      });
      field.onChange({
        name: "gender",
        value: data.gender
          ? parseGenderFromExt(data.gender, state.form.gender)
          : state.form.gender,
      });
      field.onChange({
        name: "state",
        value: data.district_object
          ? data.district_object.state
          : state.form.state,
      });
      field.onChange({
        name: "district",
        value: data.district ? data.district : state.form.district,
      });
      field.onChange({
        name: "local_body",
        value: data.local_body ? data.local_body : state.form.local_body,
      });
      field.onChange({
        name: "ward",
        value: data.ward ? data.ward : state.form.ward,
      });
      field.onChange({
        name: "village",
        value: data.village ? data.village : state.form.village,
      });
      field.onChange({
        name: "date_of_test",
        value: data.sample_collection_date
          ? data.sample_collection_date
          : state.form.date_of_test,
      });
      field.onChange({
        name: "phone_number",
        value: data.mobile_number
          ? "+91" + data.mobile_number
          : state.form.phone_number,
      });

      Promise.all([
        fetchDistricts(data.district_object.state),
        fetchLocalBody(String(data.district)),
        fetchWards(String(data.local_body)), // Convert data.local_body to a string
        duplicateCheck(data.mobile_number),
      ]);
      setShowImport({
        show: false,
        field: null,
      });
    }
  };

  const fetchData = useCallback(
    async (status: statusType) => {
      setIsLoading(true);
      const { res, data } = await request(routes.getPatient, {
        pathParams: { id: id ? id : 0 },
      });
      const { data: abhaNumberData } = await request(
        routes.abha.getAbhaNumber,
        {
          pathParams: { abhaNumberId: id ?? "" },
          silent: true,
        },
      );

      if (!status.aborted) {
        if (res?.ok && data) {
          setPatientName(data.name || "");
          if (!data.date_of_birth) {
            setAgeInputType("age");
          }
          const formData = {
            ...data,
            age: data.year_of_birth
              ? new Date().getFullYear() - data.year_of_birth
              : "",
            health_id_number: abhaNumberData?.abha_number || "",
            health_id: abhaNumberData?.health_id || "",
            nationality: data.nationality ? data.nationality : "India",
            gender: data.gender ? data.gender : undefined,
            state: data.state ? data.state : "",
            district: data.district ? data.district : "",
            blood_group: data.blood_group
              ? data.blood_group === "UNKNOWN"
                ? "UNK"
                : data.blood_group
              : "",
            local_body: data.local_body ? data.local_body : "",
            ward: data.ward_object ? data.ward_object.id : undefined,
            village: data.village ? data.village : "",
            medical_history: [] as number[],
            is_antenatal: String(!!data.is_antenatal),
            last_menstruation_start_date: data.last_menstruation_start_date,
            date_of_delivery: data.date_of_delivery,
            is_postpartum: String(!!data.date_of_delivery),
            allergies: data.allergies ? data.allergies : "",
            pincode: data.pincode ? data.pincode : "",
            ongoing_medication: data.ongoing_medication
              ? data.ongoing_medication
              : "",

            is_declared_positive: data.is_declared_positive
              ? String(data.is_declared_positive)
              : "false",
            designation_of_health_care_worker:
              data.designation_of_health_care_worker
                ? data.designation_of_health_care_worker
                : "",
            instituion_of_health_care_worker:
              data.instituion_of_health_care_worker
                ? data.instituion_of_health_care_worker
                : "",
            meta_info: data.meta_info ?? {},
            occupation: data.meta_info?.occupation
              ? parseOccupationFromExt(data.meta_info.occupation)
              : null,

            is_vaccinated: String(data.is_vaccinated),
            number_of_doses: data.number_of_doses
              ? String(data.number_of_doses)
              : "0",
            vaccine_name: data.vaccine_name ? data.vaccine_name : null,
            last_vaccinated_date: data.last_vaccinated_date
              ? data.last_vaccinated_date
              : null,
          };
          formData.sameAddress = data.address === data.permanent_address;
          setIsEmergencyNumberEnabled(
            data.phone_number === data.emergency_phone_number,
          );
          (data.medical_history ? data.medical_history : []).forEach(
            (i: any) => {
              const medicalHistory = MEDICAL_HISTORY_CHOICES.find(
                (j) =>
                  String(j.text).toLowerCase() ===
                  String(i.disease).toLowerCase(),
              );
              if (medicalHistory) {
                formData.medical_history.push(Number(medicalHistory.id));
                (formData as any)[`medical_history_${medicalHistory.id}`] =
                  i.details;
              }
            },
          );
          dispatch({
            type: "set_form",
            form: formData,
          });
          Promise.all([
            fetchDistricts(data.state ?? 0),
            fetchLocalBody(data.district ? String(data.district) : ""),
            fetchWards(data.local_body ? String(data.local_body) : ""), // Convert data.local_body to string
          ]);
        } else {
          goBack();
        }
        setIsLoading(false);
      }
    },
    [id],
  );

  useQuery(routes.listHCXPolicies, {
    query: {
      patient: id,
    },
    prefetch: !!id,
    onResponse: ({ data }) => {
      if (data) {
        setInsuranceDetails(data.results);
      } else {
        setInsuranceDetails([]);
      }
    },
  });

  const { data: stateData, loading: isStateLoading } = useQuery(
    routes.statesList,
  );

  useAbortableEffect(
    (status: statusType) => {
      if (id) {
        fetchData(status);
      }
    },
    [dispatch, fetchData],
  );

  const { data: facilityObject } = useQuery(routes.getAnyFacility, {
    pathParams: { id: facilityId },
    prefetch: !!facilityId,
  });

  const validateForm = (form: any) => {
    const errors: Partial<Record<keyof any, FieldError>> = {};

    const insuranceDetailsError = insuranceDetails
      .map((policy) => HCXPolicyValidator(policy, careConfig.hcx.enabled))
      .find((error) => !!error);
    setInsuranceDetailsError(insuranceDetailsError);

    Object.keys(form).forEach((field) => {
      let phoneNumber, emergency_phone_number;
      switch (field) {
        case "address":
        case "name":
        case "gender":
          errors[field] = RequiredFieldValidator()(form[field]);
          return;
        case "last_menstruation_start_date":
          if (form.is_antenatal === "true") {
            errors[field] = RequiredFieldValidator()(form[field]);
          }
          return;
        case "date_of_delivery":
          if (form.is_postpartum === "true") {
            errors[field] = RequiredFieldValidator()(form[field]);
          }
          return;
        case "age":
        case "date_of_birth": {
          const field = ageInputType === "age" ? "age" : "date_of_birth";

          errors[field] = RequiredFieldValidator()(form[field]);
          if (errors[field]) {
            return;
          }

          if (field === "age") {
            if (form.age < 0) {
              errors.age = "Age cannot be less than 0";
              return;
            }

            form.date_of_birth = null;
            form.year_of_birth = new Date().getFullYear() - form.age;
          }

          if (field === "date_of_birth") {
            form.age = null;
            form.year_of_birth = null;
          }

          return;
        }
        case "permanent_address":
          if (!form.sameAddress) {
            errors[field] = RequiredFieldValidator()(form[field]);
          }
          return;
        case "local_body":
          if (form.nationality === "India" && !Number(form[field])) {
            errors[field] = "Please select a localbody";
          }
          return;
        case "district":
          if (form.nationality === "India" && !Number(form[field])) {
            errors[field] = "Please select district";
          }
          return;
        case "state":
          if (form.nationality === "India" && !Number(form[field])) {
            errors[field] = "Please enter the state";
          }
          return;
        case "pincode":
          if (!validatePincode(form[field])) {
            errors[field] = "Please enter valid pincode";
          }
          return;
        case "passport_no":
          if (form.nationality !== "India" && !form[field]) {
            errors[field] = "Please enter the passport number";
          }
          return;
        case "phone_number":
          phoneNumber = parsePhoneNumber(form[field]);
          if (
            !form[field] ||
            !phoneNumber ||
            !PhoneNumberValidator()(phoneNumber) === undefined
          ) {
            errors[field] = "Please enter valid phone number";
          }
          return;
        case "emergency_phone_number":
          emergency_phone_number = parsePhoneNumber(form[field]);
          if (
            !form[field] ||
            !emergency_phone_number ||
            !PhoneNumberValidator()(emergency_phone_number) === undefined
          ) {
            errors[field] = "Please enter valid phone number";
          }
          return;
        case "blood_group":
          if (!form[field]) {
            errors[field] = "Please select a blood group";
          }
          return;
        case "is_vaccinated":
          if (form.is_vaccinated === "true") {
            if (form.number_of_doses === "0") {
              errors["number_of_doses"] =
                "Please fill the number of doses taken";
            }
            if (form.vaccine_name === null || form.vaccine_name === "Select") {
              errors["vaccine_name"] = "Please select vaccine name";
            }

            if (!form.last_vaccinated_date) {
              errors["last_vaccinated_date"] =
                "Please enter last vaccinated date";
            }
          }
          return;
        case "medical_history":
          if (!form[field].length) {
            errors[field] = "Please fill the medical history";
          }
          return;
        default:
          return;
      }
    });

    const firstError = Object.keys(errors).find((e) => errors[e]);
    if (firstError) {
      scrollTo(firstError);
    }

    return errors;
  };

  const handlePincodeChange = async (e: any, setField: any) => {
    if (!validatePincode(e.value)) return;

    const pincodeDetails = await getPincodeDetails(
      e.value,
      careConfig.govDataApiKey,
    );
    if (!pincodeDetails) return;

    const matchedState = stateData?.results?.find((state) => {
      return includesIgnoreCase(state.name, pincodeDetails.statename);
    });
    if (!matchedState) return;

    const fetchedDistricts = await fetchDistricts(matchedState.id);
    if (!fetchedDistricts) return;

    const matchedDistrict = fetchedDistricts.find((district) => {
      return includesIgnoreCase(district.name, pincodeDetails.districtname);
    });
    if (!matchedDistrict) return;

    setField({ name: "state", value: matchedState.id });
    setField({ name: "district", value: matchedDistrict.id.toString() }); // Convert matchedDistrict.id to string

    fetchLocalBody(matchedDistrict.id.toString()); // Convert matchedDistrict.id to string
    setShowAutoFilledPincode(true);
    setTimeout(() => {
      setShowAutoFilledPincode(false);
    }, 2000);
  };

  const handleSubmit = async (formData: any) => {
    setIsLoading(true);
    const medical_history: Array<medicalHistoryModel> = [];
    formData.medical_history.forEach((id: number) => {
      const medData = MEDICAL_HISTORY_CHOICES.find((i) => i.id === id);
      if (medData) {
        const details = formData[`medical_history_${medData.id}`];
        medical_history.push({
          disease: medData.text,
          details: details ? details : "",
        });
      }
    });
    const data = {
      abha_number: state.form.abha_number,
      phone_number: parsePhoneNumber(formData.phone_number),
      emergency_phone_number: parsePhoneNumber(formData.emergency_phone_number),
      date_of_birth:
        ageInputType === "date_of_birth"
          ? dateQueryString(formData.date_of_birth)
          : null,
      year_of_birth: ageInputType === "age" ? formData.year_of_birth : null,
      date_of_test: formData.date_of_test ? formData.date_of_test : undefined,
      date_declared_positive:
        JSON.parse(formData.is_declared_positive) &&
        formData.date_declared_positive
          ? formData.date_declared_positive
          : null,
      covin_id:
        formData.is_vaccinated === "true" ? formData.covin_id : undefined,
      is_vaccinated: formData.is_vaccinated,
      number_of_doses:
        formData.is_vaccinated === "true"
          ? Number(formData.number_of_doses)
          : Number("0"),
      vaccine_name:
        formData.vaccine_name &&
        formData.vaccine_name !== "Select" &&
        formData.is_vaccinated === "true"
          ? formData.vaccine_name
          : null,
      last_vaccinated_date:
        formData.is_vaccinated === "true"
          ? formData.last_vaccinated_date
            ? formData.last_vaccinated_date
            : null
          : null,
      name: _.startCase(_.toLower(formData.name)),
      pincode: formData.pincode ? formData.pincode : undefined,
      gender: Number(formData.gender),
      nationality: formData.nationality,
      is_antenatal: formData.is_antenatal,
      last_menstruation_start_date:
        formData.is_antenatal === "true"
          ? dateQueryString(formData.last_menstruation_start_date)
          : null,
      date_of_delivery:
        formData.is_postpartum === "true"
          ? dateQueryString(formData.date_of_delivery)
          : null,
      passport_no:
        formData.nationality !== "India" ? formData.passport_no : undefined,
      state: formData.nationality === "India" ? formData.state : undefined,
      district:
        formData.nationality === "India" ? formData.district : undefined,
      local_body:
        formData.nationality === "India" ? formData.local_body : undefined,
      ward: formData.ward,
      meta_info: {
        ...formData.meta_info,
        occupation: formData.occupation ?? null,
      },
      village: formData.village,
      address: formData.address ? formData.address : undefined,
      permanent_address: formData.sameAddress
        ? formData.address
        : formData.permanent_address
          ? formData.permanent_address
          : undefined,
      present_health: formData.present_health
        ? formData.present_health
        : undefined,
      allergies: formData.allergies,
      ongoing_medication: formData.ongoing_medication,
      is_declared_positive: JSON.parse(formData.is_declared_positive),
      designation_of_health_care_worker:
        formData.designation_of_health_care_worker,
      instituion_of_health_care_worker:
        formData.instituion_of_health_care_worker,
      blood_group: formData.blood_group ? formData.blood_group : undefined,
      medical_history,
      is_active: true,
      ration_card_category: formData.ration_card_category,
    };
    const { res, data: requestData } = id
      ? await request(routes.updatePatient, {
          pathParams: { id },
          body: data,
          controllerRef: submitController,
        })
      : await request(routes.addPatient, {
          body: { ...data, facility: facilityId },
          controllerRef: submitController,
        });
    if (res?.ok && requestData) {
      if (state.form.abha_number) {
        const { res, data } = await request(routes.abha.linkPatient, {
          body: {
            patient: requestData.id,
            abha_number: state.form.abha_number,
          },
        });

        if (res?.status === 200 && data) {
          Notification.Success({
            msg: t("abha_number_linked_successfully"),
          });
        } else {
          Notification.Error({
            msg: t("failed_to_link_abha_number"),
          });
        }
      }

      await Promise.all(
        insuranceDetails.map(async (obj) => {
          const policy = {
            ...obj,
            patient: requestData.id,
            insurer_id: obj.insurer_id || undefined,
            insurer_name: obj.insurer_name || undefined,
          };
          const { data: policyData } = policy.id
            ? await request(routes.updateHCXPolicy, {
                pathParams: { external_id: policy.id },
                body: policy,
              })
            : await request(routes.createHCXPolicy, {
                body: policy,
              });

          if (careConfig.hcx.enabled && policyData?.id) {
            await request(routes.hcxCheckEligibility, {
              body: { policy: policyData?.id },
              onResponse: ({ res }) => {
                if (res?.ok) {
                  Notification.Success({
                    msg: "Checking Policy Eligibility...",
                  });
                } else {
                  Notification.Error({ msg: "Something Went Wrong..." });
                }
              },
            });
          }
        }),
      );

      dispatch({ type: "set_form", form: initForm });
      if (!id) {
        setAlertMessage({
          show: true,
          message: `Please note down patient name: ${formData.name} and patient ID: ${requestData.id}`,
          title: "Patient Added Successfully",
        });
        navigate(
          `/facility/${facilityId}/patient/${requestData.id}/consultation`,
        );
      } else {
        Notification.Success({
          msg: "Patient updated successfully",
        });
        goBack();
      }
    }
    setIsLoading(false);
  };

  const handleAbhaLinking = (
    {
      id,
      abha_profile: {
        healthIdNumber,
        healthId,
        name,
        mobile,
        gender,
        monthOfBirth,
        dayOfBirth,
        yearOfBirth,
        pincode,
      },
    }: any,
    field: any,
  ) => {
    const values: any = {};
    if (id) values["abha_number"] = id;
    if (healthIdNumber) values["health_id_number"] = healthIdNumber;
    if (healthId) values["health_id"] = healthId;

    if (name)
      field("name").onChange({
        name: "name",
        value: name,
      });

    if (mobile) {
      field("phone_number").onChange({
        name: "phone_number",
        value: parsePhoneNumber(mobile, "IN"),
      });

      field("emergency_phone_number").onChange({
        name: "emergency_phone_number",
        value: parsePhoneNumber(mobile, "IN"),
      });
    }

    if (gender)
      field("gender").onChange({
        name: "gender",
        value: gender === "M" ? "1" : gender === "F" ? "2" : "3",
      });

    if (monthOfBirth && dayOfBirth && yearOfBirth)
      field("date_of_birth").onChange({
        name: "date_of_birth",
        value: new Date(`${monthOfBirth}-${dayOfBirth}-${yearOfBirth}`),
      });

    if (pincode)
      field("pincode").onChange({
        name: "pincode",
        value: pincode,
      });

    dispatch({ type: "set_form", form: { ...state.form, ...values } });
    setShowLinkAbhaNumberModal(false);
  };

  const handleMedicalCheckboxChange = (e: any, id: number, field: any) => {
    const values = field("medical_history").value ?? [];
    if (e.value) {
      values.push(id);
    } else {
      values.splice(values.indexOf(id), 1);
    }

    if (id !== 1 && values.includes(1)) {
      values.splice(values.indexOf(1), 1);
    } else if (id === 1) {
      values.length = 0;
      values.push(1);
    }

    field("medical_history").onChange({
      name: "medical_history",
      value: values,
    });
  };

  const duplicateCheck = debounce(async (phoneNo: string) => {
    if (
      phoneNo &&
      PhoneNumberValidator()(parsePhoneNumber(phoneNo) ?? "") === undefined
    ) {
      const query = {
        phone_number: parsePhoneNumber(phoneNo),
      };
      const { res, data } = await request(routes.searchPatient, {
        query,
      });
      if (res?.ok && data?.results) {
        const duplicateList = !id
          ? data.results
          : data.results.filter(
              (item: DupPatientModel) => item.patient_id !== id,
            );
        if (duplicateList.length) {
          setStatusDialog({
            show: true,
            patientList: duplicateList,
          });
        }
      }
    }
  }, 300);

  const handleDialogClose = (action: string) => {
    if (action === "transfer") {
      setStatusDialog({ ...statusDialog, show: false, transfer: true });
    } else if (action === "back") {
      setStatusDialog({ ...statusDialog, show: true, transfer: false });
    } else {
      setStatusDialog({ show: false, transfer: false, patientList: [] });
    }
  };

  const renderMedicalHistory = (id: number, title: string, field: any) => {
    const checkboxField = `medical_history_check_${id}`;
    const textField = `medical_history_${id}`;
    return (
      <div key={textField}>
        <div>
          <CheckBoxFormField
            value={(field("medical_history").value ?? []).includes(id)}
            onChange={(e) => handleMedicalCheckboxChange(e, id, field)}
            name={checkboxField}
            label={id !== 1 ? title : "NONE"}
          />
        </div>
        {id !== 1 && (field("medical_history").value ?? []).includes(id) && (
          <div className="mx-4">
            <TextAreaFormField
              {...field(textField)}
              placeholder="Details"
              rows={2}
            />
          </div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return <Loading />;
  }

  const PatientRegisterAuth = () => {
    const showAllFacilityUsers = ["DistrictAdmin", "StateAdmin"];
    if (
      !showAllFacilityUsers.includes(authUser.user_type) &&
      authUser.home_facility_object?.id === facilityId
    ) {
      return true;
    }
    if (
      authUser.user_type === "DistrictAdmin" &&
      authUser.district === facilityObject?.district
    ) {
      return true;
    }
    if (
      authUser.user_type === "StateAdmin" &&
      authUser.state === facilityObject?.state
    ) {
      return true;
    }

    return false;
  };

  if (!isLoading && facilityId && facilityObject && !PatientRegisterAuth()) {
    return <Error404 />;
  }

  return (
    <div className="px-2 pb-2">
      {statusDialog.show && (
        <DuplicatePatientDialog
          patientList={statusDialog.patientList}
          handleOk={handleDialogClose}
          handleCancel={() => {
            handleDialogClose("close");
            setResetNum(true);
          }}
        />
      )}
      {statusDialog.transfer && (
        <DialogModal
          show={statusDialog.transfer}
          onClose={() => {
            setResetNum(true);
            handleDialogClose("close");
          }}
          title="Patient Transfer Form"
          className="max-w-md md:min-w-[600px]"
        >
          <TransferPatientDialog
            patientList={statusDialog.patientList}
            handleOk={() => handleDialogClose("close")}
            handleCancel={() => {
              setResetNum(true);
              handleDialogClose("close");
            }}
            facilityId={facilityId}
          />
        </DialogModal>
      )}
      <PageTitle
        title={headerText}
        className="mb-11"
        onBackClick={() => {
          if (showImport.show) {
            setShowImport({
              show: false,
              field: null,
            });
            return false;
          } else {
            id
              ? navigate(`/facility/${facilityId}/patient/${id}`)
              : navigate(`/facility/${facilityId}`);
          }
        }}
        crumbsReplacements={{
          [facilityId]: { name: facilityObject?.name },
          [id ?? "????"]: { name: patientName },
        }}
      />
      <div className="mt-4">
        <div className="mx-4 my-8 rounded bg-purple-100 p-4 text-xs font-semibold text-purple-800">
          <div className="mx-1 mb-1 flex items-center text-lg font-bold">
            <CareIcon
              icon="l-info-circle"
              className="mr-1 text-2xl font-bold"
            />{" "}
            Please enter the correct date of birth for the patient
          </div>
          <p className="text-sm font-normal text-black">
            Each patient in the system is uniquely identifiable by the number
            and date of birth. Adding incorrect date of birth can result in
            duplication of patient records.
          </p>
        </div>
        <>
          {showAlertMessage.show && (
            <ConfirmDialog
              title={showAlertMessage.title}
              description={showAlertMessage.message}
              onConfirm={() => goBack()}
              onClose={() => goBack()}
              variant="primary"
              action="Ok"
              show
            />
          )}
          {showImport.show && (
            <div className="p-4">
              <div>
                <div className="my-4">
                  <FieldLabel htmlFor="care-external-results-id" required>
                    Enter Care External Results Id
                  </FieldLabel>
                  <TextFormField
                    id="care-external-results-id"
                    name="care-external-results-id"
                    type="text"
                    required
                    value={careExtId}
                    onChange={(e) => setCareExtId(e.value)}
                    error={state.errors.name}
                  />
                </div>
                <button
                  id="submit-importexternalresult-button"
                  className="btn btn-primary mr-4"
                  onClick={(e) => {
                    e.preventDefault();
                    fetchExtResultData(showImport?.field?.("name"));
                  }}
                  disabled={!careExtId}
                >
                  Import Patient Data from External Results
                </button>{" "}
                <button
                  className="btn border"
                  onClick={(_) =>
                    setShowImport({
                      show: false,
                      field: null,
                    })
                  }
                >
                  Cancel Import
                </button>
              </div>
            </div>
          )}
          <>
            <div className={`${showImport.show && "hidden"}`}>
              <Form<PatientForm>
                defaults={id ? state.form : initForm}
                validate={validateForm}
                onSubmit={handleSubmit}
                submitLabel={buttonText}
                onCancel={() => navigate("/facility")}
                className="bg-transparent px-1 py-2 md:px-2"
                onDraftRestore={(newState) => {
                  dispatch({ type: "set_state", state: newState });
                  Promise.all([
                    fetchDistricts(newState.form.state ?? 0),
                    fetchLocalBody(newState.form.district?.toString() ?? ""),
                    fetchWards(newState.form.local_body?.toString() ?? ""),
                    duplicateCheck(newState.form.phone_number ?? ""),
                  ]);
                }}
                noPadding
              >
                {(field) => {
                  if (!formField) setFormField(field);
                  if (resetNum) {
                    field("phone_number").onChange({
                      name: "phone_number",
                      value: "+91",
                    });
                    setResetNum(false);
                  }
                  return (
                    <>
                      <div className="mb-2 overflow-visible rounded border border-secondary-200 p-4">
                        <ButtonV2
                          id="import-externalresult-button"
                          className="flex items-center gap-2"
                          disabled={
                            authUser.user_type === "Nurse" ||
                            authUser.user_type === "Staff"
                          }
                          onClick={(_) => {
                            setShowImport({
                              show: true,
                              field,
                            });
                            setQuery({ extId: "" }, { replace: true });
                          }}
                        >
                          <CareIcon icon="l-import" className="text-lg" />
                          Import From External Results
                        </ButtonV2>
                      </div>
                      {careConfig.abdm.enabled && (
                        <div className="mb-8 overflow-visible rounded border border-secondary-200 p-4">
                          <h1 className="mb-4 text-left text-xl font-bold text-purple-500">
                            ABHA Details
                          </h1>
                          {showLinkAbhaNumberModal && (
                            <LinkABHANumberModal
                              show={showLinkAbhaNumberModal}
                              onClose={() => setShowLinkAbhaNumberModal(false)}
                              onSuccess={(data: any) => {
                                if (id) {
                                  navigate(
                                    `/facility/${facilityId}/patient/${id}`,
                                  );
                                  return;
                                }

                                handleAbhaLinking(data, field);
                              }}
                            />
                          )}
                          {!state.form.abha_number ? (
                            <button
                              className="btn btn-primary my-4"
                              onClick={(e) => {
                                e.preventDefault();
                                setShowLinkAbhaNumberModal(true);
                              }}
                            >
                              Link Abha Number
                            </button>
                          ) : (
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:gap-x-20 xl:gap-y-6">
                              <div id="abha-number">
                                <TextFormField
                                  id="abha-number"
                                  name="abha-number"
                                  label="ABHA Number"
                                  type="text"
                                  value={state.form.health_id_number}
                                  onChange={() => null}
                                  disabled={true}
                                  error=""
                                />
                              </div>
                              <div id="health-id">
                                {state.form.health_id ? (
                                  <TextFormField
                                    id="health-id"
                                    name="health-id"
                                    label="Abha Address"
                                    type="text"
                                    value={state.form.health_id}
                                    onChange={() => null}
                                    disabled={true}
                                    error=""
                                  />
                                ) : (
                                  <div className="mt-4 text-sm text-secondary-500">
                                    No Abha Address Associated with this ABHA
                                    Number
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="mb-8 overflow-visible rounded border border-secondary-200 p-4">
                        <h1 className="mb-4 text-left text-xl font-bold text-purple-500">
                          Personal Details
                        </h1>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:gap-x-20 xl:gap-y-6">
                          <div data-testid="phone-number" id="phone_number-div">
                            <PhoneNumberFormField
                              {...field("phone_number")}
                              required
                              label="Phone Number"
                              onChange={(event) => {
                                if (!id) duplicateCheck(event.value);
                                field("phone_number").onChange(event);
                                if (isEmergencyNumberEnabled) {
                                  field("emergency_phone_number").onChange({
                                    name: field("emergency_phone_number").name,
                                    value: event.value,
                                  });
                                }
                              }}
                              types={["mobile", "landline"]}
                            />
                            <CheckBoxFormField
                              label="Is the phone number an emergency number?"
                              className="font-bold"
                              id="emergency_contact_checkbox"
                              name="emergency_contact_checkbox"
                              value={isEmergencyNumberEnabled}
                              onChange={({ value }) => {
                                setIsEmergencyNumberEnabled(value);
                                value
                                  ? field("emergency_phone_number").onChange({
                                      name: field("emergency_phone_number")
                                        .name,
                                      value: field("phone_number").value,
                                    })
                                  : field("emergency_phone_number").onChange({
                                      name: field("emergency_phone_number")
                                        .name,
                                      value: initForm.emergency_phone_number,
                                    });
                              }}
                            />
                          </div>
                          <div
                            data-testid="emergency-phone-number"
                            id="emergency_phone_number-div"
                          >
                            <PhoneNumberFormField
                              {...field("emergency_phone_number")}
                              label="Emergency contact number"
                              required
                              types={["mobile", "landline"]}
                              disabled={isEmergencyNumberEnabled}
                            />
                          </div>
                          <div data-testid="name" id="name-div">
                            <TextFormField
                              required
                              {...field("name")}
                              type="text"
                              label={"Name"}
                            />
                          </div>
                          <div>
                            <FieldLabel required>
                              {ageInputType === "age" ? "Age" : "Date of Birth"}
                            </FieldLabel>
                            <div className="flex w-full items-center gap-2">
                              <SelectMenuV2
                                id="patientAge"
                                className="w-44 lg:w-32"
                                options={
                                  [
                                    {
                                      value: "date_of_birth",
                                      text: "DOB",
                                    },
                                    { value: "age", text: "Age" },
                                  ] as const
                                }
                                required
                                optionLabel={(o) => o.text}
                                optionValue={(o) =>
                                  o.value === "date_of_birth"
                                    ? "date_of_birth"
                                    : "age"
                                }
                                value={ageInputType}
                                onChange={(v) => {
                                  if (
                                    v === "age" &&
                                    ageInputType === "date_of_birth"
                                  ) {
                                    setAgeInputType("alert_for_age");
                                    return;
                                  }
                                  setAgeInputType(v);
                                }}
                              />
                              <div className="w-full">
                                {ageInputType !== "age" ? (
                                  <div
                                    data-testid="date-of-birth"
                                    id="date_of_birth-div"
                                    className="w-full"
                                  >
                                    <DateFormField
                                      className="w-full"
                                      containerClassName="w-full"
                                      {...field("date_of_birth")}
                                      errorClassName="hidden"
                                      required
                                      position="LEFT"
                                      disableFuture
                                    />
                                  </div>
                                ) : (
                                  <div id="age-div">
                                    <TextFormField
                                      {...field("age")}
                                      errorClassName="hidden"
                                      trailingPadding="pr-4"
                                      trailing={
                                        <p className="absolute right-10 space-x-1 whitespace-nowrap text-xs text-secondary-700 sm:text-sm">
                                          {field("age").value !== "" && (
                                            <>
                                              <span className="hidden sm:inline md:hidden lg:inline">
                                                Year of Birth:
                                              </span>
                                              <span className="inline sm:hidden md:inline lg:hidden">
                                                YOB:
                                              </span>
                                              <span className="font-bold">
                                                {new Date().getFullYear() -
                                                  field("age").value}
                                              </span>
                                            </>
                                          )}
                                        </p>
                                      }
                                      placeholder="Enter the age"
                                      type="number"
                                      min={0}
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                            <FieldErrorText
                              error={
                                field("age").error ||
                                field("date_of_birth").error
                              }
                            />
                            <div id="age-confirm-dialog">
                              <ConfirmDialog
                                title={"Alert!"}
                                description={
                                  <div>
                                    <div>
                                      While entering a patient's age is an
                                      option, please note that only the year of
                                      birth will be captured from this
                                      information.
                                    </div>
                                    <b>
                                      Recommended only when the patient's date
                                      of birth is unknown
                                    </b>
                                  </div>
                                }
                                action="Confirm"
                                variant="warning"
                                show={ageInputType == "alert_for_age"}
                                onClose={() => setAgeInputType("date_of_birth")}
                                onConfirm={() => setAgeInputType("age")}
                              />
                            </div>
                          </div>
                          <div data-testid="Gender" id="gender-div">
                            <SelectFormField
                              {...field("gender")}
                              required
                              label="Gender"
                              options={genderTypes}
                              onChange={(e) => {
                                field("gender").onChange(e);
                                if (e.value !== "2") {
                                  field("is_antenatal").onChange({
                                    name: "is_antenatal",
                                    value: "false",
                                  });

                                  field("is_postpartum").onChange({
                                    name: "is_postpartum",
                                    value: "false",
                                  });
                                }
                              }}
                              optionLabel={(o: any) => o.text}
                              optionValue={(o: any) => o.id}
                            />
                          </div>
                          <CollapseV2
                            opened={String(field("gender").value) === "2"}
                          >
                            {
                              <div id="is_antenatal-div" className="col-span-2">
                                <RadioFormField
                                  {...field("is_antenatal")}
                                  label="Is antenatal?"
                                  aria-label="is_antenatal"
                                  options={[
                                    { label: "Yes", value: "true" },
                                    { label: "No", value: "false" },
                                  ]}
                                  optionLabel={(option) => option.label}
                                  optionValue={(option) => option.value}
                                />
                              </div>
                            }
                          </CollapseV2>
                          <CollapseV2
                            opened={field("is_antenatal").value === "true"}
                          >
                            {
                              <div className="col-span-2">
                                <DateFormField
                                  containerClassName="w-full"
                                  {...field("last_menstruation_start_date")}
                                  label="Last Menstruation Start Date"
                                  position="LEFT"
                                  disableFuture
                                  required
                                />
                              </div>
                            }
                          </CollapseV2>
                          <CollapseV2
                            opened={String(field("gender").value) === "2"}
                          >
                            <RadioFormField
                              {...field("is_postpartum")}
                              label="Is postpartum? (<6 weeks)"
                              className="font-bold"
                              options={[
                                { label: "Yes", value: "true" },
                                { label: "No", value: "false" },
                              ]}
                              optionLabel={(option) => option.label}
                              optionValue={(option) => option.value}
                            />
                          </CollapseV2>
                          <CollapseV2
                            opened={field("is_postpartum").value === "true"}
                          >
                            <DateFormField
                              containerClassName="w-full"
                              {...field("date_of_delivery")}
                              label="Date of Delivery"
                              position="LEFT"
                              disableFuture
                              required
                            />
                          </CollapseV2>
                          <div data-testid="current-address" id="address-div">
                            <TextAreaFormField
                              {...field("address")}
                              required
                              label="Current Address"
                              placeholder="Enter the current address"
                            />
                          </div>
                          <div
                            data-testid="permanent-address"
                            id="permanent_address-div"
                          >
                            <TextAreaFormField
                              {...field("permanent_address")}
                              required
                              label="Permanent Address"
                              rows={3}
                              disabled={field("sameAddress").value}
                              placeholder="Enter the permanent address"
                              value={
                                field("sameAddress").value
                                  ? field("address").value
                                  : field("permanent_address").value
                              }
                            />
                            <CheckBoxFormField
                              {...field("sameAddress")}
                              label="Same as Current Address"
                              className="font-bold"
                            />
                          </div>

                          <div data-testid="pincode" id="pincode-div">
                            <TextFormField
                              {...field("pincode")}
                              required
                              type="text"
                              label={"Pincode"}
                              onChange={(e) => {
                                field("pincode").onChange(e);
                                handlePincodeChange(
                                  e,
                                  field("pincode").onChange,
                                );
                              }}
                            />
                            {showAutoFilledPincode && (
                              <div>
                                <CareIcon
                                  icon="l-check-circle"
                                  className="mr-2 text-sm text-green-500"
                                />
                                <span className="text-sm text-primary-500">
                                  State and District auto-filled from Pincode
                                </span>
                              </div>
                            )}
                          </div>
                          <div id="village-div">
                            <TextFormField
                              {...field("village")}
                              type="text"
                              label="Village"
                            />
                          </div>
                          <div id="nationality-div">
                            <SelectFormField
                              {...field("nationality")}
                              label="Nationality"
                              options={countryList}
                              optionLabel={(o) => o}
                              optionValue={(o) => o}
                            />
                          </div>
                          {field("nationality").value === "India" ? (
                            <>
                              <div data-testid="state" id="state-div">
                                {isStateLoading ? (
                                  <Spinner />
                                ) : (
                                  <SelectFormField
                                    {...field("state")}
                                    label="State"
                                    required
                                    placeholder="Choose State"
                                    options={stateData ? stateData.results : []}
                                    optionLabel={(o: any) => o.name}
                                    optionValue={(o: any) => o.id}
                                    onChange={(e: any) => {
                                      field("state").onChange(e);
                                      field("district").onChange({
                                        name: "district",
                                        value: undefined,
                                      });
                                      field("local_body").onChange({
                                        name: "local_body",
                                        value: undefined,
                                      });
                                      field("ward").onChange({
                                        name: "ward",
                                        value: undefined,
                                      });
                                      fetchDistricts(e.value);
                                      fetchLocalBody("0");
                                      fetchWards("0");
                                    }}
                                  />
                                )}
                              </div>

                              <div data-testid="district" id="district-div">
                                {isDistrictLoading ? (
                                  <div className="flex w-full items-center justify-center">
                                    <Spinner />
                                  </div>
                                ) : (
                                  <SelectFormField
                                    {...field("district")}
                                    label="District"
                                    required
                                    placeholder={
                                      field("state").value
                                        ? "Choose District"
                                        : "Select State First"
                                    }
                                    disabled={!field("state").value}
                                    options={districts}
                                    optionLabel={(o: any) => o.name}
                                    optionValue={(o: any) => o.id}
                                    onChange={(e: any) => {
                                      field("district").onChange(e);
                                      field("local_body").onChange({
                                        name: "local_body",
                                        value: undefined,
                                      });
                                      field("ward").onChange({
                                        name: "ward",
                                        value: undefined,
                                      });
                                      fetchLocalBody(String(e.value));
                                      fetchWards("0");
                                    }}
                                  />
                                )}
                              </div>

                              <div data-testid="localbody" id="local_body-div">
                                {isLocalbodyLoading ? (
                                  <div className="flex w-full items-center justify-center">
                                    <Spinner />
                                  </div>
                                ) : (
                                  <SelectFormField
                                    {...field("local_body")}
                                    label="Localbody"
                                    required
                                    placeholder={
                                      field("district").value
                                        ? "Choose Localbody"
                                        : "Select District First"
                                    }
                                    disabled={!field("district").value}
                                    options={localBody}
                                    optionLabel={(o) => o.name}
                                    optionValue={(o) => o.id}
                                    onChange={(e) => {
                                      field("local_body").onChange(e);
                                      field("ward").onChange({
                                        name: "ward",
                                        value: undefined,
                                      });
                                      fetchWards(String(e.value));
                                    }}
                                  />
                                )}
                              </div>
                              <div
                                data-testid="ward-respective-lsgi"
                                id="ward-div"
                              >
                                {isWardLoading ? (
                                  <div className="flex w-full items-center justify-center">
                                    <Spinner />
                                  </div>
                                ) : (
                                  <SelectFormField
                                    {...field("ward")}
                                    label="Ward"
                                    options={ward
                                      .sort(compareBy("number"))
                                      .map((e) => {
                                        return {
                                          id: e.id,
                                          name: e.number + ": " + e.name,
                                        };
                                      })}
                                    placeholder={
                                      field("local_body").value
                                        ? "Choose Ward"
                                        : "Select Localbody First"
                                    }
                                    disabled={!field("local_body").value}
                                    optionLabel={(o: any) => o.name}
                                    optionValue={(o: any) => o.id}
                                    onChange={(e: any) => {
                                      field("ward").onChange(e);
                                    }}
                                  />
                                )}
                              </div>
                            </>
                          ) : (
                            <div id="passport_no-div">
                              <TextFormField
                                label="Passport Number"
                                {...field("passport_no")}
                                type="text"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                      {field("nationality").value === "India" && (
                        <div className="mb-8 rounded border border-secondary-200 p-4">
                          <AccordionV2
                            className="mt-2 shadow-none md:mt-0 lg:mt-0"
                            expandIcon={
                              <CareIcon
                                icon="l-angle-down"
                                className="text-2xl font-bold"
                              />
                            }
                            title={
                              <h1 className="text-left text-xl font-bold text-purple-500">
                                Social Profile
                              </h1>
                            }
                            expanded
                          >
                            <div>
                              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:gap-x-20 xl:gap-y-6">
                                <AutocompleteFormField
                                  {...field("occupation")}
                                  label="Occupation"
                                  placeholder="Select Occupation"
                                  options={occupationTypes}
                                  optionLabel={(o) => o.text}
                                  optionValue={(o) => o.id}
                                />
                                <SelectFormField
                                  {...field("ration_card_category")}
                                  label="Ration Card Category"
                                  placeholder="Select"
                                  options={RATION_CARD_CATEGORY}
                                  optionLabel={(o) => t(`ration_card__${o}`)}
                                  optionValue={(o) => o}
                                />
                                <RadioFormField
                                  name="socioeconomic_status"
                                  label={t("socioeconomic_status")}
                                  options={SOCIOECONOMIC_STATUS_CHOICES}
                                  optionLabel={(o) =>
                                    t(`SOCIOECONOMIC_STATUS__${o}`)
                                  }
                                  optionValue={(o) => o}
                                  value={
                                    field("meta_info").value
                                      ?.socioeconomic_status
                                  }
                                  onChange={({ name, value }) =>
                                    field("meta_info").onChange({
                                      name: "meta_info",
                                      value: {
                                        ...(field("meta_info").value ?? {}),
                                        [name]: value,
                                      },
                                    })
                                  }
                                />
                                <RadioFormField
                                  name="domestic_healthcare_support"
                                  label={t("has_domestic_healthcare_support")}
                                  options={DOMESTIC_HEALTHCARE_SUPPORT_CHOICES}
                                  optionLabel={(o) =>
                                    t(`DOMESTIC_HEALTHCARE_SUPPORT__${o}`)
                                  }
                                  optionValue={(o) => o}
                                  value={
                                    field("meta_info").value
                                      ?.domestic_healthcare_support
                                  }
                                  onChange={({ name, value }) =>
                                    field("meta_info").onChange({
                                      name: "meta_info",
                                      value: {
                                        ...(field("meta_info").value ?? {}),
                                        [name]: value,
                                      },
                                    })
                                  }
                                />
                              </div>
                            </div>
                          </AccordionV2>
                        </div>
                      )}
                      <div className="mb-8 rounded border border-secondary-200 p-4">
                        <AccordionV2
                          className="mt-2 shadow-none md:mt-0 lg:mt-0"
                          expandIcon={
                            <CareIcon
                              icon="l-angle-down"
                              className="text-2xl font-bold"
                            />
                          }
                          title={
                            <h1 className="text-left text-xl font-bold text-purple-500">
                              COVID Details
                            </h1>
                          }
                        >
                          <div>
                            <div className="mt-5 grid w-full grid-cols-1 gap-4 sm:grid-cols-3 xl:gap-x-20 xl:gap-y-6">
                              <div className="col-span-full">
                                <RadioFormField
                                  label="Is patient Vaccinated against COVID?"
                                  aria-label="is_vaccinated"
                                  {...field("is_vaccinated")}
                                  options={[
                                    { label: "Yes", value: "true" },
                                    { label: "No", value: "false" },
                                  ]}
                                  optionLabel={(option) => option.label}
                                  optionValue={(option) => option.value}
                                />
                              </div>
                            </div>
                            <div className="mt-5 grid w-full grid-cols-1 gap-4 xl:gap-x-20 xl:gap-y-6">
                              <CollapseV2
                                opened={
                                  String(field("is_vaccinated").value) ===
                                  "true"
                                }
                              >
                                {
                                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:gap-x-20 xl:gap-y-6">
                                    <div id="covin_id-div">
                                      <TextFormField
                                        label="COWIN ID"
                                        {...field("covin_id")}
                                        type="text"
                                      />
                                    </div>
                                    <div id="number_of_doses-div">
                                      <RadioFormField
                                        label="Number of doses"
                                        {...field("number_of_doses")}
                                        options={[
                                          { label: "1", value: "1" },
                                          { label: "2", value: "2" },
                                          {
                                            label:
                                              "3 (Booster/Precautionary Dose)",
                                            value: "3",
                                          },
                                        ]}
                                        optionLabel={(option) => option.label}
                                        optionValue={(option) => option.value}
                                      />
                                    </div>
                                    <div id="vaccine_name-div">
                                      <SelectFormField
                                        {...field("vaccine_name")}
                                        label="Vaccine Name"
                                        options={vaccines}
                                        optionLabel={(o) => o}
                                        optionValue={(o) => o}
                                      />
                                    </div>
                                    <div id="last_vaccinated_date-div">
                                      <DateFormField
                                        {...field("last_vaccinated_date")}
                                        label="Last Date of Vaccination"
                                        disableFuture={true}
                                        position="LEFT"
                                      />
                                    </div>
                                  </div>
                                }
                              </CollapseV2>
                            </div>
                            <div className="mt-5 grid w-full grid-cols-1 gap-4 xl:gap-x-20 xl:gap-y-6">
                              <div id="is_declared_positive-div">
                                <RadioFormField
                                  {...field("is_declared_positive")}
                                  label="Is patient declared covid postive by state?"
                                  aria-label="is_declared_positive"
                                  options={[
                                    { label: "Yes", value: "true" },
                                    { label: "No", value: "false" },
                                  ]}
                                  optionLabel={(option) => option.label}
                                  optionValue={(option) => option.value}
                                />
                                <CollapseV2
                                  opened={
                                    String(
                                      field("is_declared_positive").value,
                                    ) === "true"
                                  }
                                  className="mt-4"
                                >
                                  <div id="date_declared_positive-div">
                                    <DateFormField
                                      {...field("date_declared_positive")}
                                      label="Date Patient is Declared Positive for COVID"
                                      disableFuture
                                      position="LEFT"
                                    />
                                  </div>
                                </CollapseV2>
                              </div>
                              <div id="date_of_test-div">
                                <DateFormField
                                  {...field("date_of_test")}
                                  id="date_of_test"
                                  label="Date of Sample given for COVID Test"
                                  disableFuture
                                  position="LEFT"
                                />
                              </div>
                            </div>
                          </div>
                        </AccordionV2>
                      </div>
                      <div className="mb-8 overflow-visible rounded border p-4">
                        <h1 className="mb-4 text-left text-xl font-bold text-purple-500">
                          Medical History
                        </h1>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:gap-x-20 xl:gap-y-6">
                          <div id="present_health-div">
                            <TextAreaFormField
                              {...field("present_health")}
                              label="Present Health Condition"
                              rows={3}
                              placeholder="Optional Information"
                            />
                          </div>

                          <div id="ongoing_medication-div">
                            <TextAreaFormField
                              {...field("ongoing_medication")}
                              label="Ongoing Medication"
                              rows={3}
                              placeholder="Optional Information"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <FieldLabel id="med-history-label" required>
                              Any medical history? (Comorbidities)
                            </FieldLabel>
                            <div className={"flex flex-wrap gap-2"}>
                              {MEDICAL_HISTORY_CHOICES.map((i) => {
                                return renderMedicalHistory(
                                  i.id as number,
                                  i.text,
                                  field,
                                );
                              })}
                            </div>
                            <FieldErrorText
                              error={field("medical_history")["error"]}
                            />
                          </div>

                          <div id="allergies-div">
                            <TextAreaFormField
                              {...field("allergies")}
                              label="Allergies"
                              rows={1}
                              placeholder="Optional Information"
                            />
                          </div>

                          <div data-testid="blood-group" id="blood_group-div">
                            <SelectFormField
                              {...field("blood_group")}
                              position="above"
                              label="Blood Group"
                              required
                              options={bloodGroups}
                              optionLabel={(o: any) => o}
                              optionValue={(o: any) => o}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="flex w-full flex-col gap-4 rounded border border-secondary-200 bg-white p-4">
                        <div className="flex w-full flex-col items-center justify-between gap-4 sm:flex-row">
                          <h1 className="text-left text-xl font-bold text-purple-500">
                            Insurance Details
                          </h1>
                          <ButtonV2
                            type="button"
                            variant="alert"
                            border
                            ghost={insuranceDetails.length !== 0}
                            onClick={() =>
                              setInsuranceDetails([
                                ...insuranceDetails,
                                {
                                  id: "",
                                  subscriber_id: "",
                                  policy_id: "",
                                  insurer_id: "",
                                  insurer_name: "",
                                },
                              ])
                            }
                            data-testid="add-insurance-button"
                          >
                            <CareIcon icon="l-plus" className="text-lg" />
                            <span>Add Insurance Details</span>
                          </ButtonV2>
                        </div>
                        <InsuranceDetailsBuilder
                          name="insurance_details"
                          value={insuranceDetails}
                          onChange={({ value }) => setInsuranceDetails(value)}
                          error={insuranceDetailsError}
                          gridView
                        />
                      </div>
                    </>
                  );
                }}
              </Form>
            </div>
          </>
        </>
      </div>
    </div>
  );
};

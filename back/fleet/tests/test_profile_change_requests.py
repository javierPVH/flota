"""Peticiones de corregir la ficha personal: la persona pide, la gestión decide.

En la app de campo «Mi perfil» es de lectura. Lo que se prueba aquí es lo que
hace fiable esa puerta: que solo se pueda pedir sobre la PROPIA ficha, que solo
viajen los campos que se dejan pedir —ni el DNI ni el correo—, que no se
dupliquen, que sin nada que corregir la nota sea obligatoria y que aplicarla
escriba de verdad la ficha (y rechazarla no la toque).
"""

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import LicenseType, Role
from fleet.models import ProfileChangeRequest
from fleet.models.enums import ProfileChangeStatus

from .helpers import make_user


class ProfileChangeRequestTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.driver = make_user("carlos", Role.DRIVER)
        self.driver.first_name = "Carlos"
        self.driver.phone = "600 000 000"
        self.driver.license_type = LicenseType.B
        self.driver.dni = "11111111H"
        self.driver.save()
        self.other = make_user("lucia", Role.DRIVER)
        self.url = reverse("profilechangerequest-list")

    # --- Alta ------------------------------------------------------------
    def test_driver_asks_to_correct_his_own_profile(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            self.url,
            {
                "changes": {"phone": "600 111 222", "license_type": "C"},
                "note": "Me saqué el C el mes pasado.",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        peticion = ProfileChangeRequest.objects.get()
        self.assertEqual(peticion.user, self.driver)
        self.assertEqual(peticion.requested_by, self.driver)
        self.assertEqual(peticion.status, ProfileChangeStatus.PENDING)
        self.assertEqual(peticion.changes, {"phone": "600 111 222", "license_type": "C"})
        # La ficha NO se toca al pedirlo: eso es justo lo que decide gestión.
        self.driver.refresh_from_db()
        self.assertEqual(self.driver.phone, "600 000 000")

    def test_the_request_is_always_about_your_own_profile(self):
        """`user` es de solo lectura: mandarlo no abre la ficha de otra persona."""
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            self.url,
            {"user": self.other.pk, "changes": {"phone": "600 111 222"}},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(ProfileChangeRequest.objects.get().user, self.driver)

    def test_second_request_does_not_duplicate_the_row(self):
        """Idempotente por persona: el reenvío no llena la bandeja."""
        self.client.force_authenticate(self.driver)
        cuerpo = {"changes": {"phone": "600 111 222"}}
        self.client.post(self.url, cuerpo, format="json")
        self.client.post(self.url, cuerpo, format="json")
        self.assertEqual(ProfileChangeRequest.objects.count(), 1)

    def test_a_field_that_is_not_of_the_record_is_rejected(self):
        """La ficha entera se puede pedir; lo que no es la ficha, no."""
        self.client.force_authenticate(self.driver)
        for campo, valor in (("is_superuser", True), ("username", "otro"), ("password", "x")):
            with self.subTest(campo=campo):
                resp = self.client.post(self.url, {"changes": {campo: valor}}, format="json")
                self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(ProfileChangeRequest.objects.count(), 0)

    def test_the_whole_record_can_be_asked_for(self):
        """Los siete campos de la ficha, incluidos el correo, el DNI y la tarjeta."""
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            self.url,
            {
                "changes": {
                    "first_name": "Carlos",  # igual que la ficha: no es un cambio
                    "last_name": "Ruiz",
                    "email": "carlos.nuevo@flota.dev",
                    "dni": "99999999R",
                    "phone": "600 111 222",
                    "license_type": "C",
                    "fuel_card": True,
                }
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(
            ProfileChangeRequest.objects.get().changes,
            {
                "last_name": "Ruiz",
                "email": "carlos.nuevo@flota.dev",
                "dni": "99999999R",
                "phone": "600 111 222",
                "license_type": "C",
                "fuel_card": True,
            },
        )

    def test_an_email_or_a_dni_of_another_account_is_refused_when_asking(self):
        """Identidad: se dice en el momento, no al intentar aplicarla."""
        self.other.email = "lucia@flota.dev"
        self.other.dni = "22222222J"
        self.other.save()
        self.client.force_authenticate(self.driver)
        for campo, valor in (("email", "LUCIA@flota.dev"), ("dni", "22222222J")):
            with self.subTest(campo=campo):
                resp = self.client.post(self.url, {"changes": {campo: valor}}, format="json")
                self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
                self.assertIn(campo, resp.data.get("errors", resp.data))
        self.assertEqual(ProfileChangeRequest.objects.count(), 0)

    def test_an_identity_taken_in_the_meantime_blocks_applying_it(self):
        """Entre pedirla y decidirla, ese correo se lo ha quedado otra cuenta."""
        peticion = ProfileChangeRequest.objects.create(
            user=self.driver, changes={"email": "lucia@flota.dev"}
        )
        self.other.email = "lucia@flota.dev"
        self.other.save()

        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            reverse("profilechangerequest-resolve", args=[peticion.pk]),
            {"decision": "done"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        peticion.refresh_from_db()
        # Sigue pendiente: no se ha aplicado a medias ni se ha cerrado en falso.
        self.assertEqual(peticion.status, ProfileChangeStatus.PENDING)
        self.driver.refresh_from_db()
        self.assertNotEqual(self.driver.email, "lucia@flota.dev")

    def test_the_fuel_card_travels_as_a_yes_or_no(self):
        peticion = ProfileChangeRequest.objects.create(
            user=self.driver, changes={"fuel_card": True}
        )
        self.client.force_authenticate(self.admin)
        resp = self.client.get(reverse("profilechangerequest-detail", args=[peticion.pk]))
        self.assertEqual(
            resp.data["changes_display"],
            [
                {
                    "field": "fuel_card",
                    "label": "Tarjeta de combustible",
                    "current": "No",
                    "proposed": "Sí",
                }
            ],
        )
        self.client.post(
            reverse("profilechangerequest-resolve", args=[peticion.pk]),
            {"decision": "done"},
            format="json",
        )
        self.driver.refresh_from_db()
        self.assertTrue(self.driver.fuel_card)

    def test_what_is_already_in_the_profile_is_not_a_change(self):
        """Pedir lo que ya está puesto no es pedir nada: se cae, y queda la nota."""
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            self.url,
            {"changes": {"phone": "600 000 000"}, "note": "Revisadme la ficha."},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(ProfileChangeRequest.objects.get().changes, {})

    def test_without_changes_the_note_is_required(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.post(self.url, {"changes": {}}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("note", resp.data.get("errors", resp.data))

    # --- Lectura ---------------------------------------------------------
    def test_everyone_sees_only_their_own_and_the_admin_sees_them_all(self):
        mia = ProfileChangeRequest.objects.create(user=self.driver, note="La mía.")
        ProfileChangeRequest.objects.create(user=self.other, note="La suya.")

        self.client.force_authenticate(self.driver)
        resp = self.client.get(self.url)
        self.assertEqual([row["id"] for row in resp.data["results"]], [mia.pk])

        self.client.force_authenticate(self.admin)
        resp = self.client.get(self.url)
        self.assertEqual(resp.data["count"], 2)

    def test_the_row_says_what_is_asked_with_the_before_and_after(self):
        peticion = ProfileChangeRequest.objects.create(
            user=self.driver, changes={"phone": "600 111 222"}
        )
        self.client.force_authenticate(self.admin)
        resp = self.client.get(reverse("profilechangerequest-detail", args=[peticion.pk]))
        self.assertEqual(
            resp.data["changes_display"],
            [
                {
                    "field": "phone",
                    "label": "Teléfono",
                    "current": "600 000 000",
                    "proposed": "600 111 222",
                }
            ],
        )
        self.assertEqual(resp.data["user_name"], "Carlos")

    # --- Decisión --------------------------------------------------------
    def test_applying_it_writes_the_profile(self):
        peticion = ProfileChangeRequest.objects.create(
            user=self.driver, changes={"phone": "600 111 222", "license_type": "C"}
        )
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            reverse("profilechangerequest-resolve", args=[peticion.pk]),
            {"decision": "done", "note": "Verificado con el permiso."},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.driver.refresh_from_db()
        self.assertEqual(self.driver.phone, "600 111 222")
        self.assertEqual(self.driver.license_type, LicenseType.C)
        peticion.refresh_from_db()
        self.assertEqual(peticion.status, ProfileChangeStatus.DONE)
        self.assertEqual(peticion.resolved_by, self.admin)
        self.assertIsNotNone(peticion.resolved_at)

    def test_rejecting_it_does_not_touch_the_profile(self):
        peticion = ProfileChangeRequest.objects.create(
            user=self.driver, changes={"phone": "600 111 222"}
        )
        self.client.force_authenticate(self.admin)
        self.client.post(
            reverse("profilechangerequest-resolve", args=[peticion.pk]),
            {"decision": "reject", "note": "El móvil de empresa es el de la ficha."},
            format="json",
        )
        self.driver.refresh_from_db()
        self.assertEqual(self.driver.phone, "600 000 000")
        peticion.refresh_from_db()
        self.assertEqual(peticion.status, ProfileChangeStatus.REJECTED)

    def test_only_the_admin_decides(self):
        peticion = ProfileChangeRequest.objects.create(
            user=self.driver, changes={"phone": "600 111 222"}
        )
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            reverse("profilechangerequest-resolve", args=[peticion.pk]),
            {"decision": "done"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.driver.refresh_from_db()
        self.assertEqual(self.driver.phone, "600 000 000")

    def test_a_resolved_request_is_not_decided_twice(self):
        peticion = ProfileChangeRequest.objects.create(
            user=self.driver,
            changes={"phone": "600 111 222"},
            status=ProfileChangeStatus.REJECTED,
        )
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            reverse("profilechangerequest-resolve", args=[peticion.pk]),
            {"decision": "done"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_what_management_already_fixed_is_not_applied_again(self):
        """Entre pedir y decidir, la ficha ha podido corregirse por su cuenta."""
        peticion = ProfileChangeRequest.objects.create(
            user=self.driver, changes={"phone": "600 111 222", "license_type": "C"}
        )
        self.driver.phone = "600 111 222"
        self.driver.save(update_fields=["phone"])

        self.client.force_authenticate(self.admin)
        self.client.post(
            reverse("profilechangerequest-resolve", args=[peticion.pk]),
            {"decision": "done"},
            format="json",
        )
        self.driver.refresh_from_db()
        self.assertEqual(self.driver.phone, "600 111 222")
        self.assertEqual(self.driver.license_type, LicenseType.C)

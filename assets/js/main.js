(function () {
  "use strict";

  const body = document.body;
  const header = document.querySelector("[data-header]");
  const nav = document.querySelector("[data-nav]");
  const navToggle = document.querySelector("[data-nav-toggle]");
  const backToTop = document.querySelector("[data-back-to-top]");
  const language = (document.documentElement.lang || "es").slice(0, 2).toLowerCase();
  const messages = {
    es: {
      openMenu: "Abrir menú",
      closeMenu: "Cerrar menú",
      project: "Proyecto",
      projectDescription: "Descripción del proyecto.",
      name: "Indica tu nombre.",
      email: "Introduce un email válido.",
      phone: "Indica un teléfono de contacto.",
      service: "Selecciona el tipo de servicio.",
      message: "Cuéntanos un poco más sobre el proyecto.",
      privacy: "Debes aceptar la política de privacidad.",
      success: "Gracias. Hemos recibido tu solicitud de forma simulada y te contactaremos con los datos definitivos cuando el formulario esté conectado."
    },
    fr: {
      openMenu: "Ouvrir le menu",
      closeMenu: "Fermer le menu",
      project: "Projet",
      projectDescription: "Description du projet.",
      name: "Indiquez votre nom.",
      email: "Saisissez une adresse e-mail valide.",
      phone: "Indiquez un numéro de téléphone.",
      service: "Sélectionnez le type de service.",
      message: "Donnez-nous quelques précisions sur votre projet.",
      privacy: "Vous devez accepter la politique de confidentialité.",
      success: "Merci. Votre demande a été enregistrée en mode simulation. Nous vous contacterons avec les informations définitives une fois le formulaire connecté."
    },
    en: {
      openMenu: "Open menu",
      closeMenu: "Close menu",
      project: "Project",
      projectDescription: "Project description.",
      name: "Please enter your name.",
      email: "Enter a valid email address.",
      phone: "Enter a contact phone number.",
      service: "Select a service type.",
      message: "Tell us a little more about the project.",
      privacy: "You must accept the privacy policy.",
      success: "Thank you. Your request has been recorded in simulation mode. We will contact you with the final details once the form is connected."
    },
    de: {
      openMenu: "Menü öffnen",
      closeMenu: "Menü schließen",
      project: "Projekt",
      projectDescription: "Projektbeschreibung.",
      name: "Bitte geben Sie Ihren Namen ein.",
      email: "Geben Sie eine gültige E-Mail-Adresse ein.",
      phone: "Geben Sie eine Telefonnummer an.",
      service: "Wählen Sie eine Leistung aus.",
      message: "Beschreiben Sie Ihr Projekt bitte etwas genauer.",
      privacy: "Sie müssen der Datenschutzerklärung zustimmen.",
      success: "Vielen Dank. Ihre Anfrage wurde im Simulationsmodus erfasst. Sobald das Formular verbunden ist, melden wir uns mit den endgültigen Informationen."
    }
  };
  const copy = messages[language] || messages.es;

  function setHeaderState() {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 8);
  }

  function closeNav() {
    if (!nav || !navToggle) return;
    nav.classList.remove("is-open");
    navToggle.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", copy.openMenu);
    body.classList.remove("nav-open");
  }

  if (navToggle && nav) {
    navToggle.addEventListener("click", function () {
      const isOpen = nav.classList.toggle("is-open");
      navToggle.classList.toggle("is-open", isOpen);
      navToggle.setAttribute("aria-expanded", String(isOpen));
      navToggle.setAttribute("aria-label", isOpen ? copy.closeMenu : copy.openMenu);
      body.classList.toggle("nav-open", isOpen);
    });

    nav.addEventListener("click", function (event) {
      if (event.target.closest("a")) closeNav();
    });
  }

  window.addEventListener("scroll", function () {
    setHeaderState();
    if (backToTop) {
      backToTop.classList.toggle("is-visible", window.scrollY > 500);
    }
  }, { passive: true });

  window.addEventListener("resize", function () {
    if (window.innerWidth >= 900) closeNav();
  });

  setHeaderState();

  if (backToTop) {
    backToTop.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  const revealItems = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && revealItems.length) {
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });

    revealItems.forEach(function (item) {
      observer.observe(item);
    });
  } else {
    revealItems.forEach(function (item) {
      item.classList.add("is-visible");
    });
  }

  const filterButtons = document.querySelectorAll("[data-filter]");
  const projectItems = document.querySelectorAll(".project-item");
  const projectsGrid = document.querySelector("[data-projects-grid]");

  if (filterButtons.length && projectItems.length) {
    filterButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        const filter = button.dataset.filter;

        filterButtons.forEach(function (item) {
          const isActive = item === button;
          item.classList.toggle("is-active", isActive);
          item.setAttribute("aria-pressed", String(isActive));
        });

        projectItems.forEach(function (project) {
          const shouldShow = filter === "todos" || project.dataset.category === filter;
          project.classList.toggle("is-hidden", !shouldShow);
        });

        if (projectsGrid) {
          const visibleCount = Array.from(projectItems).filter(function (project) {
            return !project.classList.contains("is-hidden");
          }).length;
          projectsGrid.classList.toggle("has-single-result", visibleCount === 1);
        }
      });
    });
  }

  const modal = document.querySelector("[data-project-modal]");
  const modalTitle = document.querySelector("[data-modal-title]");
  const modalCategory = document.querySelector("[data-modal-category]");
  const modalDescription = document.querySelector("[data-modal-description]");
  const modalImage = document.querySelector("[data-modal-image]");
  let lastFocusedElement = null;

  function openProjectModal(project) {
    if (!modal || !project) return;
    lastFocusedElement = document.activeElement;

    const visual = project.querySelector(".project-media, .placeholder, img");
    const category = project.querySelector("p") ? project.querySelector("p").textContent : copy.project;

    if (modalTitle) modalTitle.textContent = project.dataset.title || copy.project;
    if (modalCategory) modalCategory.textContent = category;
    if (modalDescription) modalDescription.textContent = project.dataset.description || copy.projectDescription;
    if (modalImage && visual) {
      modalImage.innerHTML = "";
      modalImage.appendChild(visual.cloneNode(true));
    }

    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    body.classList.add("modal-open");

    const closeButton = modal.querySelector(".modal-close");
    if (closeButton) closeButton.focus();
  }

  function closeProjectModal() {
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    body.classList.remove("modal-open");

    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus();
    }
  }

  if (modal) {
    document.querySelectorAll(".project-open").forEach(function (button) {
      button.addEventListener("click", function () {
        openProjectModal(button.closest(".project-item"));
      });
    });

    modal.querySelectorAll("[data-modal-close]").forEach(function (button) {
      button.addEventListener("click", closeProjectModal);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && modal.classList.contains("is-open")) {
        closeProjectModal();
      }
    });
  }

  const contactForm = document.querySelector("[data-contact-form]");

  if (contactForm) {
    const serviceParam = new URLSearchParams(window.location.search).get("servicio");
    const serviceSelect = contactForm.elements.service;
    if (serviceParam && serviceSelect) {
      const matchingOption = Array.from(serviceSelect.options).some(function (option) {
        return option.value === serviceParam;
      });
      if (matchingOption) serviceSelect.value = serviceParam;
    }
  }

  function setFieldError(field, message) {
    if (!field) return;
    const row = field.closest(".form-row");
    const error = document.querySelector('[data-error-for="' + field.name + '"]');

    if (row) row.classList.toggle("has-error", Boolean(message));
    if (error) error.textContent = message || "";
  }

  function validateEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  if (contactForm) {
    contactForm.addEventListener("submit", function (event) {
      event.preventDefault();

      const fields = {
        name: contactForm.elements.name,
        email: contactForm.elements.email,
        phone: contactForm.elements.phone,
        service: contactForm.elements.service,
        message: contactForm.elements.message,
        privacy: contactForm.elements.privacy
      };

      let isValid = true;
      Object.keys(fields).forEach(function (key) {
        setFieldError(fields[key], "");
      });

      if (!fields.name.value.trim()) {
        setFieldError(fields.name, copy.name);
        isValid = false;
      }

      if (!validateEmail(fields.email.value.trim())) {
        setFieldError(fields.email, copy.email);
        isValid = false;
      }

      if (fields.phone.value.trim().length < 6) {
        setFieldError(fields.phone, copy.phone);
        isValid = false;
      }

      if (!fields.service.value) {
        setFieldError(fields.service, copy.service);
        isValid = false;
      }

      if (fields.message.value.trim().length < 10) {
        setFieldError(fields.message, copy.message);
        isValid = false;
      }

      if (!fields.privacy.checked) {
        setFieldError(fields.privacy, copy.privacy);
        isValid = false;
      }

      const success = document.querySelector("[data-form-success]");
      if (!isValid) {
        const firstError = contactForm.querySelector(".has-error input, .has-error select, .has-error textarea");
        if (firstError) firstError.focus();
        if (success) success.textContent = "";
        return;
      }

      contactForm.reset();
      if (success) {
        success.textContent = copy.success;
      }
    });
  }
})();

/**
 * Project Page — Mobile Navigation + Sticky Header
 * Lightweight version of main.js functions needed on case study pages.
 */
jQuery(function ($) {
    'use strict';

    // Clone desktop menu for mobile
    var mobileMenuClone = $('#menu').clone().attr('id', 'navigation-mobile');

    // Insert mobile menu if viewport ≤ 979px
    function setupMobileNav() {
        if ($(window).width() <= 979) {
            if ($('#navigation-mobile').length === 0) {
                mobileMenuClone.insertAfter('#menu');
                $('#navigation-mobile #menu-nav').attr('id', 'menu-nav-mobile');
            }
        } else {
            $('#navigation-mobile').css('display', 'none');
            $('#mobile-nav').removeClass('open');
        }
    }

    setupMobileNav();
    $(window).on('resize', setupMobileNav);

    // Toggle mobile menu on hamburger click
    $('#mobile-nav').on('click', function (e) {
        e.preventDefault();
        $(this).toggleClass('open');
        if ($(this).hasClass('open')) {
            $('#navigation-mobile').slideDown(400);
        } else {
            $('#navigation-mobile').slideUp(400);
        }
    });

    // Close mobile menu when a link is clicked
    $(document).on('click', '#menu-nav-mobile a', function () {
        $('#mobile-nav').removeClass('open');
        $('#navigation-mobile').slideUp(300);
    });

    // Sticky header on scroll
    $(window).on('scroll', function () {
        if ($(this).scrollTop() > 1) {
            $('header .sticky-nav').addClass('stuck');
        } else {
            $('header .sticky-nav').removeClass('stuck');
        }
    });
});
